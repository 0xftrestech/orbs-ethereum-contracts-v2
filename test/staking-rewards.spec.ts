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

describe('staking-rewards-level-flows', async () => {

  it('should distribute staking rewards to validators in committee', async () => {
    const d = await Driver.new();

    /* top up staking rewards pool */
    const g = d.rewardsGovernor;

    const poolRate = 2000000000;
    const poolAmount = poolRate*12;

    let r = await d.stakingRewards.setPoolMonthlyRate(poolRate, {from: g.address});
    const startTime = await txTimestamp(r);
    await g.assignAndApproveOrbs(poolAmount, d.stakingRewards.address);
    await d.stakingRewards.topUpPool(poolAmount, {from: g.address});

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

    expect(await d.stakingRewards.getLastPayedAt()).to.be.bignumber.equal(new BN(startTime));

    await sleep(3000);
    await evmIncreaseTime(MONTH_IN_SECONDS*4);

    r = await d.stakingRewards.assignRewards();
    const endTime = await txTimestamp(r);
    const elapsedTime = endTime - startTime;

    const calcRewards = (rate: number) => {
      const totalCommitteeStake = new BN(_.sumBy(validators, v => v.stake.toNumber()));
      const rewards = new BN(Math.floor(rate * elapsedTime / MONTH_IN_SECONDS));
      const rewardsArr = validators.map(v => rewards.mul(v.stake).div(totalCommitteeStake));
      const remainder =  rewards.sub(new BN(_.sumBy(rewardsArr, r => r.toNumber())));
      const remainderWinnerIdx = endTime % nValidators;
      rewardsArr[remainderWinnerIdx] = rewardsArr[remainderWinnerIdx].add(remainder);
      return rewardsArr;
    };

    // Total of each token
    const totalOrbsRewardsArr = calcRewards(poolRate);

    const orbsBalances:BN[] = [];
    for (const v of validators) {
      orbsBalances.push(new BN(await d.stakingRewards.getOrbsBalance(v.v.address)));
    }

    for (const v of validators) {
      const i = validators.indexOf(v);
      expect(orbsBalances[i]).to.be.bignumber.equal(new BN(totalOrbsRewardsArr[i]));

      r = await d.stakingRewards.distributeOrbsTokenRewards([v.v.address], [totalOrbsRewardsArr[i]], {from: v.v.address});
      expect(r).to.have.a.stakedEvent({
        stakeOwner: v.v.address,
        amount: totalOrbsRewardsArr[i],
        totalStakedAmount: new BN(v.stake).add(totalOrbsRewardsArr[i])
      });
      expect(r).to.have.a.committeeChangedEvent({
        orbsAddrs: validators.map(v => v.v.orbsAddress),
        addrs: validators.map(v => v.v.address),
        stakes: validators.map((_v, _i) => (_i <= i) ? new BN(_v.stake).add(totalOrbsRewardsArr[_i]) : new BN(_v.stake))
      });
    }
  })
});
