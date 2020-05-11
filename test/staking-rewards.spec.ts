import 'mocha';

import * as _ from "lodash";
import BN from "bn.js";
import {Driver, DEPLOYMENT_SUBSET_MAIN, expectRejected} from "./driver";
import chai from "chai";
import {bn, evmIncreaseTime} from "./helpers";
import {TransactionReceipt} from "web3-core";
import {Web3Driver} from "../eth";

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

describe('staking-rewards-level-flows', async () => {

  it('should distribute staking rewards to validators in general committee', async () => {
    const d = await Driver.new();

    /* top up staking rewards pool */
    const g = d.rewardsGovernor;

    const annualRate = 12000;
    const poolAmount = 2000000000;
    const annualCap = poolAmount;

    let r = await d.stakingRewards.setAnnualRate(annualRate, annualCap, {from: g.address});
    const startTime = await txTimestamp(d.web3, r);
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

    expect(await d.stakingRewards.getLastRewardsAssignment()).to.be.bignumber.equal(new BN(startTime));

    await sleep(3000);
    await evmIncreaseTime(d.web3, YEAR_IN_SECONDS*4);

    const assignRewardTxRes = await d.stakingRewards.assignRewards();
    const endTime = await txTimestamp(d.web3, assignRewardTxRes);
    const elapsedTime = endTime - startTime;

    const calcRewards = () => {
      const totalCommitteeStake = _.sumBy(validators, v => v.stake.toNumber());
      const annualAmount = Math.min(Math.floor(annualRate * totalCommitteeStake / 100000), annualCap);
      const rewards = new BN(Math.floor(annualAmount * elapsedTime / YEAR_IN_SECONDS));
      const rewardsArr = validators.map(v => rewards.mul(v.stake).div(bn(totalCommitteeStake)));
      const remainder =  rewards.sub(new BN(_.sumBy(rewardsArr, r => r.toNumber())));
      const remainderWinnerIdx = endTime % nValidators;
      rewardsArr[remainderWinnerIdx] = rewardsArr[remainderWinnerIdx].add(remainder);
      return rewardsArr;
    };

    const totalOrbsRewardsArr = calcRewards();

    const orbsBalances:BN[] = [];
    for (const v of validators) {
      orbsBalances.push(new BN(await d.stakingRewards.getRewardBalance(v.v.address)));
    }

    for (const v of validators) {
      const delegator = d.newParticipant();
      await delegator.delegate(v.v);

      const i = validators.indexOf(v);
      expect(orbsBalances[i]).to.be.bignumber.equal(new BN(totalOrbsRewardsArr[i]));
      expect(assignRewardTxRes).to.have.a.stakingRewardAssignedEvent({
        assignee: v.v.address,
        amount: bn(new BN(totalOrbsRewardsArr[i])),
        balance: bn(new BN(totalOrbsRewardsArr[i])) // todo: a test where balance is different than amount
      });

      r = await d.stakingRewards.distributeOrbsTokenRewards(
          totalOrbsRewardsArr[i],
          0,
          100,
          1,
          0,
          [delegator.address],
          [totalOrbsRewardsArr[i]],
          {from: v.v.address}
        );
      expect(r).to.have.a.stakingRewardsDistributedEvent({
        distributer: v.v.address,
        fromBlock: bn(0),
        toBlock: bn(100),
        split: bn(1),
        txIndex: bn(0),
        to: [delegator.address],
        amounts: [totalOrbsRewardsArr[i]]
      });
      expect(r).to.have.a.stakedEvent({
        stakeOwner: v.v.address,
        amount: totalOrbsRewardsArr[i],
        totalStakedAmount: totalOrbsRewardsArr[i]
      });
      expect(r).to.have.a.committeeChangedEvent({
        orbsAddrs: validators.map(v => v.v.orbsAddress),
        addrs: validators.map(v => v.v.address),
        weights: validators.map((_v, _i) => (_i <= i) ? new BN(_v.stake).add(totalOrbsRewardsArr[_i]) : new BN(_v.stake))
      });
    }
  });

  it('should enforce the annual cap', async () => {
    const d = await Driver.new();

    /* top up staking rewards pool */
    const g = d.rewardsGovernor;

    const annualRate = 12000;
    const poolAmount = 2000000000;
    const annualCap = 100;

    let r = await d.stakingRewards.setAnnualRate(annualRate, annualCap, {from: g.address}); // todo monthly to annual
    const startTime = await txTimestamp(d.web3, r);
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

    expect(await d.stakingRewards.getLastRewardsAssignment()).to.be.bignumber.equal(new BN(startTime));

    await sleep(3000);
    await evmIncreaseTime(d.web3, YEAR_IN_SECONDS*4);

    const assignRewardTxRes = await d.stakingRewards.assignRewards();
    const endTime = await txTimestamp(d.web3, assignRewardTxRes);
    const elapsedTime = endTime - startTime;

    const calcRewards = () => {
      const totalCommitteeStake = _.sumBy(validators, v => v.stake.toNumber());
      const annualAmount = Math.min(Math.floor(annualRate * totalCommitteeStake / 100000), annualCap);
      const rewards = new BN(Math.floor(annualAmount * elapsedTime / YEAR_IN_SECONDS));
      const rewardsArr = validators.map(v => rewards.mul(v.stake).div(bn(totalCommitteeStake)));
      const remainder =  rewards.sub(new BN(_.sumBy(rewardsArr, r => r.toNumber())));
      const remainderWinnerIdx = endTime % nValidators;
      rewardsArr[remainderWinnerIdx] = rewardsArr[remainderWinnerIdx].add(remainder);
      return rewardsArr;
    };

    const totalOrbsRewardsArr = calcRewards();

    const orbsBalances:BN[] = [];
    for (const v of validators) {
      orbsBalances.push(new BN(await d.stakingRewards.getRewardBalance(v.v.address)));
    }

    for (const v of validators) {
      const delegator = d.newParticipant();
      await delegator.delegate(v.v);

      const i = validators.indexOf(v);
      expect(orbsBalances[i]).to.be.bignumber.equal(new BN(totalOrbsRewardsArr[i]));
      expect(assignRewardTxRes).to.have.a.stakingRewardAssignedEvent({
        assignee: v.v.address,
        amount: bn(new BN(totalOrbsRewardsArr[i])),
        balance: bn(new BN(totalOrbsRewardsArr[i])) // todo: a test where balance is different than amount
      });

      r = await d.stakingRewards.distributeOrbsTokenRewards(
          totalOrbsRewardsArr[i],
          0,
          100,
          1,
          0,
          [delegator.address],
          [totalOrbsRewardsArr[i]],
          {from: v.v.address});
      expect(r).to.have.a.stakingRewardsDistributedEvent({
        distributer: v.v.address,
        fromBlock: bn(0),
        toBlock: bn(100),
        split: bn(1),
        txIndex: bn(0),
        to: [delegator.address],
        amounts: [totalOrbsRewardsArr[i]]
      });
      expect(r).to.have.a.stakedEvent({
        stakeOwner: delegator.address,
        amount: totalOrbsRewardsArr[i],
        totalStakedAmount: totalOrbsRewardsArr[i]
      });
      expect(r).to.have.a.committeeChangedEvent({
        orbsAddrs: validators.map(v => v.v.orbsAddress),
        addrs: validators.map(v => v.v.address),
        weights: validators.map((_v, _i) => (_i <= i) ? new BN(_v.stake).add(totalOrbsRewardsArr[_i]) : new BN(_v.stake))
      });
    }
  });

  it('should enforce totalAmount, fromBlock, toBlock, split, txIndex to be consecutive', async () => {
    const d = await Driver.new();

    const {v} = await d.newValidator(1000, false, false, true);
    const {v: v2} = await d.newValidator(1000, false, false, true);

    const delegator = d.newParticipant();

    /* top up staking rewards pool */
    const g = d.rewardsGovernor;

    const annualRate = 12000;
    const poolAmount = 2000000000;
    const annualCap = 2000000000;

    await d.stakingRewards.setAnnualRate(annualRate, annualCap, {from: g.address});
    await g.assignAndApproveOrbs(poolAmount, d.stakingRewards.address);
    await d.stakingRewards.topUpPool(poolAmount, {from: g.address});

    await evmIncreaseTime(d.web3, YEAR_IN_SECONDS);

    await d.stakingRewards.assignRewards();

    // first fromBlock must be 0
    await expectRejected(d.stakingRewards.distributeOrbsTokenRewards(
        5,
        1,
        100,
        1,
        0,
        [delegator.address],
        [5],
        {from: v.address})
    );

    // first txIndex must be 0 (initial distribution)
    await expectRejected(d.stakingRewards.distributeOrbsTokenRewards(
        5,
        0,
        100,
        1,
        1,
        [delegator.address],
        [5],
        {from: v.address})
    );

    // should fail if total does not match actual total
    await expectRejected(d.stakingRewards.distributeOrbsTokenRewards(
        5,
        0,
        100,
        1,
        1,
        [],
        [],
        {from: v.address})
    );

    let r = await d.stakingRewards.distributeOrbsTokenRewards(
        5,
        0,
        100,
        1,
        0,
        [delegator.address],
        [5],
        {from: v.address}
      );
    expect(r).to.have.a.stakingRewardsDistributedEvent({
      distributer: v.address,
      fromBlock: bn(0),
      toBlock: bn(100),
      split: bn(1),
      txIndex: bn(0),
      to: [delegator.address],
      amounts: [bn(5)]
    });

    // next txIndex must increment the previous one
    await expectRejected(d.stakingRewards.distributeOrbsTokenRewards(
        5,
        0,
        100,
        1,
        0,
        [delegator.address],
        [5],
        {from: v.address}
      )
    );
    await expectRejected(d.stakingRewards.distributeOrbsTokenRewards(
        5,
        0,
        100,
        1,
        2,
        [delegator.address],
        [5],
        {from: v.address}
      )
    );

    r = await d.stakingRewards.distributeOrbsTokenRewards(
        5,
        0,
        100,
        1,
        1,
        [delegator.address],
        [5],
        {from: v.address}
    );
    expect(r).to.have.a.stakingRewardsDistributedEvent({
      distributer: v.address,
      fromBlock: bn(0),
      toBlock: bn(100),
      split: bn(1),
      txIndex: bn(1),
      to: [delegator.address],
      amounts: [bn(5)]
    });

    r = await d.stakingRewards.distributeOrbsTokenRewards(
        5,
        0,
        100,
        1,
        2,
        [delegator.address],
        [5],
        {from: v.address}
    );
    expect(r).to.have.a.stakingRewardsDistributedEvent({
      distributer: v.address,
      fromBlock: bn(0),
      toBlock: bn(100),
      split: bn(1),
      txIndex: bn(2),
      to: [delegator.address],
      amounts: [bn(5)]
    });

    // next split must equal previous
    await expectRejected(d.stakingRewards.distributeOrbsTokenRewards(
        5,
        0,
        100,
        2,
        3,
        [delegator.address],
        [5],
        {from: v.address}
        )
    );

    // next fromBlock must be previous toBlock + 1
    await expectRejected(d.stakingRewards.distributeOrbsTokenRewards(
        5,
        99,
        200,
        2,
        0,
        [delegator.address],
        [5],
        {from: v.address}
        )
    );

    await expectRejected(d.stakingRewards.distributeOrbsTokenRewards(
        5,
        100,
        200,
        2,
        0,
        [delegator.address],
        [5],
        {from: v.address}
        )
    );

    // next toBlock must be at least new fromBlock
    await expectRejected(d.stakingRewards.distributeOrbsTokenRewards(
        5,
        101,
        100,
        2,
        0,
        [delegator.address],
        [5],
        {from: v.address}
        )
    );

    // on new distribution, txIndex must be 0
    await expectRejected(d.stakingRewards.distributeOrbsTokenRewards(
        5,
        101,
        200,
        2,
        1,
        [delegator.address],
        [5],
        {from: v.address}
        )
    );

    // split can be changed on new distribution
    r = await d.stakingRewards.distributeOrbsTokenRewards(
        5,
        101,
        200,
        3,
        0,
        [delegator.address],
        [5],
        {from: v.address}
    );
    expect(r).to.have.a.stakingRewardsDistributedEvent({
      distributer: v.address,
      fromBlock: bn(101),
      toBlock: bn(200),
      split: bn(3),
      txIndex: bn(0),
      to: [delegator.address],
      amounts: [bn(5)]
    });

    // state is per address, different distributor must start from fromBlock==0
    r = await d.stakingRewards.distributeOrbsTokenRewards(
        5,
        0,
        100,
        1,
        0,
        [delegator.address],
        [5],
        {from: v2.address}
    );
    expect(r).to.have.a.stakingRewardsDistributedEvent({
      distributer: v2.address,
      fromBlock: bn(0),
      toBlock: bn(100),
      split: bn(1),
      txIndex: bn(0),
      to: [delegator.address],
      amounts: [bn(5)]
    });

    // toBlock must be in the past
    await expectRejected(d.stakingRewards.distributeOrbsTokenRewards(
        5,
        101,
        (r.blockNumber + 10000),
        1,
        0,
        [delegator.address],
        [5],
        {from: v2.address}
    ));

  });

});
