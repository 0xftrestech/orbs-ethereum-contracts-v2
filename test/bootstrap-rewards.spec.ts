import 'mocha';

import * as _ from "lodash";
import BN from "bn.js";
import {Driver, Participant} from "./driver";
import chai from "chai";
import {bn, evmIncreaseTime, fromTokenUnits, toTokenUnits} from "./helpers";
import {TransactionReceipt} from "web3-core";
import {Web3Driver} from "../eth";
import {bootstrapRewardsAssignedEvents} from "./event-parsing";

chai.use(require('chai-bn')(BN));
chai.use(require('./matchers'));

const YEAR_IN_SECONDS = 365*24*60*60;

async function txTimestamp(web3: Web3Driver, r: TransactionReceipt): Promise<number> { // TODO move
  return (await web3.eth.getBlock(r.blockNumber)).timestamp as number;
}

const expect = chai.expect;

async function sleep(ms): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

describe('bootstrap-rewards-level-flows', async () => {

  it('should distribute bootstrap rewards to guardians in committee', async () => {
    const d = await Driver.new({maxCommitteeSize: 4});

    /* top up bootstrap reward  pool */

    const g = d.functionalOwner;

    const annualAmountGeneral = fromTokenUnits(10000000);
    const annualAmountCertification = fromTokenUnits(20000000);
    const poolAmount = annualAmountGeneral.add(annualAmountCertification).mul(bn(6*12));

    await d.rewards.setGeneralCommitteeAnnualBootstrap(annualAmountGeneral, {from: g.address});
    await d.rewards.setCertificationCommitteeAnnualBootstrap(annualAmountCertification, {from: g.address});

    await g.assignAndApproveExternalToken(poolAmount, d.rewards.address);
    let r = await d.rewards.topUpBootstrapPool(fromTokenUnits(1), {from: g.address});
    expect(r).to.have.a.bootstrapAddedToPoolEvent({
      added: fromTokenUnits(1),
      total: fromTokenUnits(1)
    });

    r = await d.rewards.topUpBootstrapPool(poolAmount.sub(fromTokenUnits(1)), {from: g.address});
    expect(r).to.have.a.bootstrapAddedToPoolEvent({
      added: poolAmount.sub(fromTokenUnits(1)),
      total: poolAmount
    });

    // create committee

    const initStakeLesser = fromTokenUnits(17000);
    const initStakeLarger = fromTokenUnits(21000);

    const {v: v1} = await d.newGuardian(initStakeLarger, true, false, true);
    const {v: v2} = await d.newGuardian(initStakeLarger, false, false, true);
    const {v: v3} = await d.newGuardian(initStakeLesser, true, false, true);
    const {v: v4, r: firstAssignTxRes} = await d.newGuardian(initStakeLesser, false, false, true);
    const startTime = await txTimestamp(d.web3, firstAssignTxRes);
    const generalCommittee: Participant[] = [v1, v2, v3, v4];

    const initialBalance:BN[] = [];
    for (const v of generalCommittee) {
      initialBalance.push(new BN(await d.rewards.getBootstrapBalance(v.address)));
    }

    await sleep(3000);
    await evmIncreaseTime(d.web3, YEAR_IN_SECONDS*4);

    const assignRewardsTxRes = await d.rewards.assignRewards();
    const endTime = await txTimestamp(d.web3, assignRewardsTxRes);
    const elapsedTime = endTime - startTime;

    const calcRewards = (annualRate) => fromTokenUnits(toTokenUnits(annualRate).mul(bn(elapsedTime)).div(bn(YEAR_IN_SECONDS)));

    const expectedGeneralCommitteeRewards = calcRewards(annualAmountGeneral);
    const expectedCertificationCommitteeRewards = expectedGeneralCommitteeRewards.add(calcRewards(annualAmountCertification));

    expect(assignRewardsTxRes).to.have.a.bootstrapRewardsAssignedEvent({
      generalGuardianAmount: expectedGeneralCommitteeRewards.toString(),
      certifiedGuardianAmount: expectedCertificationCommitteeRewards.toString()
    });

    const tokenBalances:BN[] = [];
    for (const v of generalCommittee) {
      tokenBalances.push(new BN(await d.rewards.getBootstrapBalance(v.address)));
    }

    for (const v of generalCommittee) {
      const i = generalCommittee.indexOf(v);

      const expectedRewards = (i % 2 == 0) ? expectedCertificationCommitteeRewards : expectedGeneralCommitteeRewards;
      expect(tokenBalances[i].sub(initialBalance[i])).to.be.bignumber.equal(expectedRewards.toString());

      // claim the funds
      const r = await d.rewards.withdrawBootstrapFunds({from: v.address});
      const tokenBalance = await d.externalToken.balanceOf(v.address);
      expect(r).to.have.a.bootstrapRewardsWithdrawnEvent({
            guardian: v.address,
            amount: bn(tokenBalance)
      });

      expect(new BN(tokenBalance)).to.bignumber.equal(new BN(tokenBalances[i]));
    }
  })
});
