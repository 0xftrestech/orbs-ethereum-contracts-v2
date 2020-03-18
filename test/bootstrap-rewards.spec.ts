import 'mocha';

import * as _ from "lodash";
import BN from "bn.js";
import {Driver, DEPLOYMENT_SUBSET_MAIN} from "./driver";
import chai from "chai";
import {evmIncreaseTime} from "./helpers";
import {web3} from "../eth";
import {TransactionReceipt} from "web3-core";

chai.use(require('chai-bn')(BN));
chai.use(require('./matchers'));

const MONTH_IN_SECONDS = 30*24*60*60;

async function txTimestamp(r: TransactionReceipt): Promise<number> { // TODO move
  return (await web3.eth.getBlock(r.blockNumber)).timestamp as number;
}

const expect = chai.expect;

async function sleep(ms): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

describe('bootstrap-rewards-level-flows', async () => {

  it('should distribute bootstrap rewards to validators in committee', async () => {
    const d = await Driver.new();

    /* top up bootstrap reward  pool */

    const g = d.rewardsGovernor;

    const fixedPoolRate = 10000000;
    const fixedPoolAmount = fixedPoolRate*12;

    let r = await d.bootstrapRewards.setPoolMonthlyRate(fixedPoolRate, {from: g.address});
    const startTime = await txTimestamp(r);
    await g.assignAndApproveExternalToken(fixedPoolAmount, d.bootstrapRewards.address);
    await d.bootstrapRewards.topUpPool(fixedPoolAmount, {from: g.address});

    // create committee

    const initStakeLesser = new BN(17000);
    const v1 = d.newParticipant();
    await v1.stake(initStakeLesser);
    await v1.registerAsValidator();
    await v1.notifyReadyForCommittee();

    const initStakeLarger = new BN(21000);
    const v2 = d.newParticipant();
    await v2.stake(initStakeLarger);
    await v2.registerAsValidator();
    await v2.notifyReadyForCommittee();

    const validators = [{
      v: v2,
      stake: initStakeLarger
    }, {
      v: v1,
      stake: initStakeLesser
    }];

    const nValidators = validators.length;

    await sleep(3000);
    await evmIncreaseTime(MONTH_IN_SECONDS*4);

    r = await d.bootstrapRewards.assignRewards();
    const endTime = await txTimestamp(r);
    const elapsedTime = endTime - startTime;

    const calcRewards = (rate: number) => {
      const rewards = new BN(Math.floor(rate * elapsedTime / MONTH_IN_SECONDS));
      const rewardsArr = validators.map(() => rewards.div(new BN(validators.length)));
      const remainder =  rewards.sub(new BN(_.sumBy(rewardsArr, r => r.toNumber())));
      const remainderWinnerIdx = endTime % nValidators;
      rewardsArr[remainderWinnerIdx] = rewardsArr[remainderWinnerIdx].add(remainder);
      return rewardsArr;
    };

    const totalExternalTokenRewardsArr = calcRewards(fixedPoolRate);

    const externalBalances:BN[] = [];
    for (const v of validators) {
      externalBalances.push(new BN(await d.bootstrapRewards.getExternalTokenBalance(v.v.address)));
    }

    for (const v of validators) {
      const i = validators.indexOf(v);

      expect(externalBalances[i]).to.be.bignumber.equal(new BN(totalExternalTokenRewardsArr[i]));

      // claim the funds
      const expectedBalance = parseInt(await d.bootstrapRewards.getExternalTokenBalance(v.v.address));
      expect(expectedBalance).to.be.equal(externalBalances[i].toNumber());
      await d.bootstrapRewards.withdrawFunds({from: v.v.address});
      const externalBalance = await d.externalToken.balanceOf(v.v.address);
      expect(new BN(externalBalance)).to.bignumber.equal(new BN(expectedBalance));
    }

  })
});
