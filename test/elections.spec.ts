import 'mocha';

import BN from "bn.js";
import {
    defaultDriverOptions,
    BANNING_LOCK_TIMEOUT,
    Driver,
    expectRejected,
    Participant
} from "./driver";
import chai from "chai";
chai.use(require('chai-bn')(BN));
chai.use(require('./matchers'));

const expect = chai.expect;
const assert = chai.assert;

import {bn, evmIncreaseTime, fromTokenUnits} from "./helpers";

const baseStake = 100;

describe('elections-high-level-flows', async () => {

    it('emits events on readyForCommittee and readyToSync', async () => {
        const d = await Driver.new();

        const {v} = await d.newValidator(fromTokenUnits(10), false, false, false);

        let r = await v.notifyReadyToSync();
        expect(r).to.have.a.validatorStatusUpdatedEvent({
            addr: v.address,
            readyToSync: true,
            readyForCommittee: false
        });

        r = await v.notifyReadyForCommittee();
        expect(r).to.have.a.validatorStatusUpdatedEvent({
            addr: v.address,
            readyToSync: true,
            readyForCommittee: true
        });
    });

    it('allows sending readyForCommittee and readyToSync form both guardian and orbs address', async () => {
        const d = await Driver.new();

        const {v} = await d.newValidator(fromTokenUnits(10), false, false, false);

        let r = await d.elections.notifyReadyToSync({from: v.orbsAddress});
        expect(r).to.have.a.validatorStatusUpdatedEvent({
            addr: v.address,
            readyToSync: true,
            readyForCommittee: false
        });

        r = await d.elections.notifyReadyToSync({from: v.address});
        expect(r).to.have.a.validatorStatusUpdatedEvent({
            addr: v.address,
            readyToSync: true,
            readyForCommittee: false
        });

        r = await d.elections.notifyReadyForCommittee({from: v.orbsAddress});
        expect(r).to.have.a.validatorStatusUpdatedEvent({
            addr: v.address,
            readyToSync: true,
            readyForCommittee: true
        });

        r = await d.elections.notifyReadyForCommittee({from: v.address});
        expect(r).to.have.a.validatorStatusUpdatedEvent({
            addr: v.address,
            readyToSync: true,
            readyForCommittee: true
        });
    });

    it('rejects readyForCommittee and readyToSync from an unregistered validator', async () => {
        const d = await Driver.new();

        const v = d.newParticipant();

        await expectRejected(d.elections.notifyReadyToSync({from: v.address}));
        await expectRejected(d.elections.notifyReadyForCommittee({from: v.address}));
    });

    it('handle delegation requests', async () => {
        const d = await Driver.new();

        const d1 = await d.newParticipant();
        const d2 = await d.newParticipant();

        const r = await d1.delegate(d2);
        expect(r).to.have.a.delegatedEvent({
            from: d1.address,
            to: d2.address
        });
    });

    it('sorts committee by stake', async () => {
        const stake100 = new BN(100);
        const stake200 = new BN(200);
        const stake300 = new BN(300);
        const stake500 = new BN(500);
        const stake1000 = new BN(1000);

        const d = await Driver.new({maxCommitteeSize: 2});

        // First validator registers
        const validatorStaked100 = d.newParticipant();
        let r = await validatorStaked100.stake(stake100);
        expect(r).to.have.a.stakedEvent();

        await validatorStaked100.registerAsValidator();
        r = await validatorStaked100.notifyReadyToSync();

        r = await validatorStaked100.notifyReadyForCommittee();
        expect(r).to.have.a.committeeSnapshotEvent({
            addrs: [validatorStaked100.address],
            weights: [stake100],
        });

        const validatorStaked200 = d.newParticipant();
        r = await validatorStaked200.stake(stake200);
        expect(r).to.have.a.stakeChangedEvent({addr: validatorStaked200.address, committeeStake: stake200});

        await validatorStaked200.registerAsValidator();
        await validatorStaked200.notifyReadyToSync();
        r = await validatorStaked200.notifyReadyForCommittee();
        expect(r).to.have.a.committeeSnapshotEvent({
            addrs: [validatorStaked200.address, validatorStaked100.address],
            weights: [stake200, stake100]
        });

        // A third validator registers high ranked

        const validatorStaked300 = d.newParticipant();
        r = await validatorStaked300.stake(stake300);
        expect(r).to.have.a.stakedEvent();

        await validatorStaked300.registerAsValidator();

        r = await validatorStaked300.notifyReadyToSync();
        r = await validatorStaked300.notifyReadyForCommittee();
        expect(r).to.have.a.committeeSnapshotEvent({
            addrs: [validatorStaked300.address, validatorStaked200.address],
            weights: [stake300, stake200]
        });

        r = await d.delegateMoreStake(stake300, validatorStaked200);
        expect(r).to.have.a.committeeSnapshotEvent({
            addrs: [validatorStaked200.address, validatorStaked300.address],
            weights: [stake200.add(stake300), stake300]
        });

        r = await d.delegateMoreStake(stake500, validatorStaked100);
        expect(r).to.have.a.committeeSnapshotEvent({
            addrs: [validatorStaked100.address, validatorStaked200.address],
            weights: [stake100.add(stake500), stake500]
        });

        // A new validator registers, stakes and enters the topology

        const inTopologyValidator = d.newParticipant();
        r = await inTopologyValidator.stake(stake100);
        expect(r).to.have.a.stakedEvent();
        await inTopologyValidator.registerAsValidator();
        r = await inTopologyValidator.notifyReadyToSync();
        r = await inTopologyValidator.notifyReadyForCommittee();
        expect(r).to.not.have.a.committeeSnapshotEvent();

        // The bottom validator in the topology delegates more stake and switches places with the second to last
        r = await d.delegateMoreStake(201, inTopologyValidator);

        // A new validator registers and stakes but does not enter the topology
        const outOfTopologyValidator = d.newParticipant();
        r = await outOfTopologyValidator.stake(stake100);
        expect(r).to.have.a.stakedEvent();
        await outOfTopologyValidator.registerAsValidator();
        await outOfTopologyValidator.notifyReadyToSync();
        r = await outOfTopologyValidator.notifyReadyForCommittee();
        expect(r).to.not.have.a.committeeSnapshotEvent();

        // A new validator stakes enough to get to the top
        const validator = d.newParticipant();
        await validator.registerAsValidator();
        await validator.notifyReadyForCommittee();
        r = await validator.stake(stake1000); // now top of committee
        expect(r).to.have.a.committeeSnapshotEvent({
            addrs: [validator.address, validatorStaked100.address],
            weights: [stake1000, stake100.add(stake500)]
        });
    });

    it('votes out a committee member', async () => {
        assert(defaultDriverOptions.voteOutThreshold < 98); // so each committee member will hold a positive stake
        assert(Math.floor(defaultDriverOptions.voteOutThreshold / 2) >= 98 - defaultDriverOptions.voteOutThreshold); // so the committee list will be ordered by stake

        const stakesPercentage = [
            Math.ceil(defaultDriverOptions.voteOutThreshold / 2),
            Math.floor(defaultDriverOptions.voteOutThreshold / 2),
            98 - defaultDriverOptions.voteOutThreshold,
            1,
            1
        ];
        const committeeSize = stakesPercentage.length;
        const thresholdCrossingIndex = 1;

        const d = await Driver.new({maxCommitteeSize: committeeSize, });

        let r;
        const committee: Participant[] = [];
        for (const p of stakesPercentage) {
            const v = d.newParticipant();
            await v.registerAsValidator();
            await v.notifyReadyForCommittee();
            r = await v.stake(baseStake * p);
            committee.push(v);
        }
        expect(r).to.have.a.committeeSnapshotEvent({
            addrs: committee.map(v => v.address)
        });

        // A committee member is voted out, rejoins, and voted-out again. This makes sure that once voted-out, the
        // votes are discarded and must be recast to vote-out a validator again.
        for (let i = 0; i < 2; i++) {
            // Part of the committee votes out, threshold is not yet reached
            const votedOutValidator = committee[committeeSize - 1];
            for (const v of committee.slice(0, thresholdCrossingIndex)) {
                const r = await d.elections.voteOut(votedOutValidator.address, {from: v.orbsAddress});
                expect(r).to.have.a.voteOutEvent({
                    voter: v.address,
                    against: votedOutValidator.address
                });
                expect(r).to.not.have.a.votedOutOfCommitteeEvent();
                expect(r).to.not.have.a.committeeSnapshotEvent();
            }

            r = await d.elections.voteOut(votedOutValidator.address, {from: committee[thresholdCrossingIndex].orbsAddress}); // Threshold is reached
            expect(r).to.have.a.voteOutEvent({
                voter: committee[thresholdCrossingIndex].address,
                against: votedOutValidator.address
            });
            expect(r).to.have.a.votedOutOfCommitteeEvent({
                addr: votedOutValidator.address
            });
            expect(r).to.have.a.validatorStatusUpdatedEvent({
                addr: votedOutValidator.address,
                readyToSync: false,
                readyForCommittee: false
            });
            expect(r).to.have.a.committeeSnapshotEvent({
                addrs: committee.filter(v => v != votedOutValidator).map(v => v.address)
            });

            // voted-out validator re-joins by notifying ready-for-committee
            r = await votedOutValidator.notifyReadyForCommittee();
            expect(r).to.have.a.committeeSnapshotEvent({
                addrs: committee.map(v => v.address)
            });
        }
    });

    it('discards stale votes', async () => {
        assert(defaultDriverOptions.voteOutThreshold > 50); // so one out of two equal committee members does not cross the threshold

        const committeeSize = 2;
        const d = await Driver.new({maxCommitteeSize: committeeSize});

        let r;
        const committee: Participant[] = [];
        for (let i = 0; i < committeeSize; i++) {
            const v = d.newParticipant();
            await v.registerAsValidator();
            await v.notifyReadyForCommittee();
            r = await v.stake(100);
            committee.push(v);
        }
        expect(r).to.have.a.committeeSnapshotEvent({
            addrs: committee.map(v => v.address)
        });

        r = await d.elections.voteOut(committee[1].address, {from: committee[0].orbsAddress});
        expect(r).to.have.a.voteOutEvent({
            voter: committee[0].address,
            against: committee[1].address,
        });

        // ...*.* TiMe wArP *.*.....
        await evmIncreaseTime(d.web3, defaultDriverOptions.voteOutTimeout);

        r = await d.elections.voteOut(committee[1].address, {from: committee[1].orbsAddress}); // this should have crossed the vote-out threshold, but the previous vote had timed out
        expect(r).to.have.a.voteOutEvent({
            voter: committee[1].address,
            against: committee[1].address,
        });
        expect(r).to.not.have.a.votedOutOfCommitteeEvent();
        expect(r).to.not.have.a.committeeSnapshotEvent();

        // recast the stale vote-out, threshold should be reached
        r = await d.elections.voteOut(committee[1].address, {from: committee[0].orbsAddress});
        expect(r).to.have.a.voteOutEvent({
            voter: committee[0].address,
            against: committee[1].address,
        });
        expect(r).to.have.a.votedOutOfCommitteeEvent({
            addr: committee[1].address
        });
        expect(r).to.have.a.committeeSnapshotEvent({
            addrs: [committee[0].address]
        });
    });

    it('does not allow to notify ready without registration', async () => {
        const d = await Driver.new();

        const V1_STAKE = 100;

        const v = d.newParticipant();
        await v.stake(V1_STAKE);
        await expectRejected(v.notifyReadyToSync());
        await expectRejected(v.notifyReadyForCommittee());
    });

    it('staking before or after delegating has the same effect', async () => {
        const d = await Driver.new();

        const aValidator = d.newParticipant();
        let r = await aValidator.stake(100);

        // stake before delegate
        const delegator1 = d.newParticipant();
        await delegator1.stake(100);
        r = await delegator1.delegate(aValidator);

        expect(r).to.have.a.stakeChangedEvent({addr: aValidator.address, committeeStake: new BN(200)});

        // delegate before stake
        const delegator2 = d.newParticipant();
        await delegator2.delegate(aValidator);
        r = await delegator2.stake(100);

        expect(r).to.have.a.stakeChangedEvent({addr: aValidator.address, committeeStake: new BN(300)});
    });

    it('does not count delegated stake twice', async () => {
        const d = await Driver.new();

        const v1 = d.newParticipant();
        const v2 = d.newParticipant();

        await v1.stake(100);
        await v2.stake(100); // required due to the delegation cap ratio

        const r = await v1.delegate(v2);
        expect(r).to.have.a.stakeChangedEvent({
            addr: v1.address,
            committeeStake: new BN(0)
        });
        expect(r).to.have.a.stakeChangedEvent({
            addr: v2.address,
            committeeStake: new BN(200)
        });
    });

    it('enforces effective stake limit of x-times the own stake', async () => {
        const d = await Driver.new({maxCommitteeSize: 2, maxDelegationRatio: 10});

        const v1 = d.newParticipant();
        const v2 = d.newParticipant();

        await v1.registerAsValidator();
        await v1.notifyReadyForCommittee();

        await v2.delegate(v1);

        await v1.stake(100);

        let r = await v2.stake(900);
        expect(r).to.have.a.stakeChangedEvent({
            addr: v1.address,
            committeeStake: new BN(1000),
        });

        r = await v2.stake(1);
        expect(r).to.have.a.stakeChangedEvent({
            addr: v1.address,
            committeeStake: new BN(1000),
        });

        r = await v2.unstake(2);
        expect(r).to.have.a.stakeChangedEvent({
            addr: v1.address,
            committeeStake: new BN(999),
        });

        r = await v2.stake(11);
        expect(r).to.have.a.stakeChangedEvent({
            addr: v1.address,
            committeeStake: new BN(1000),
        });
        expect(r).to.have.a.committeeSnapshotEvent({
            addrs: [v1.address],
            weights: [new BN(1000)]
        });

        r = await v1.stake(2);
        expect(r).to.have.a.stakeChangedEvent({
            addr: v1.address,
            committeeStake: new BN(1012),
        });
        expect(r).to.have.a.committeeSnapshotEvent({
            addrs: [v1.address],
            weights: [new BN(1012)]
        });

        r = await v2.stake(30);
        expect(r).to.have.a.stakeChangedEvent({
            addr: v1.address,
            committeeStake: new BN(1020),
        });
        expect(r).to.have.a.committeeSnapshotEvent({
            addrs: [v1.address],
            weights: [new BN(1020)]
        });

        r = await v1.stake(1);
        expect(r).to.have.a.stakeChangedEvent({
            addr: v1.address,
            committeeStake: new BN(1030),
        });
        expect(r).to.have.a.committeeSnapshotEvent({
            addrs: [v1.address],
            weights: [new BN(1030)]
        });
    });

    it('ensures validator who delegated cannot join committee even when owning enough stake', async () => {
        const d = await Driver.new();
        const v1 = d.newParticipant();
        const v2 = d.newParticipant();

        await v1.delegate(v2);
        await v1.stake(baseStake);
        await v1.registerAsValidator();
        await v1.notifyReadyForCommittee();

        await v2.registerAsValidator();
        await v2.notifyReadyForCommittee();
        let r = await v2.stake(baseStake);

        // Make sure v1 does not enter the committee
        expect(r).to.have.a.committeeSnapshotEvent({
            addrs: [v2.address],
        });
    });

    it('ensures a non-ready validator cannot join the committee even when owning enough stake', async () => {
        const d = await Driver.new();
        const v = d.newParticipant();
        await v.stake(baseStake);
        await v.registerAsValidator();
        let r = await v.notifyReadyToSync();
        r = await v.notifyReadyForCommittee();
        expect(r).to.have.a.committeeSnapshotEvent({
            addrs: [v.address]
        });

        const {r: r2} = await d.newValidator(baseStake * 2, false, true, false);
        expect(r2).to.not.have.a.committeeSnapshotEvent();
    });

    it('publishes a CommiteeChangedEvent when the commitee becomes empty', async () => {
        const d = await Driver.new();
        const v = d.newParticipant();
        await v.registerAsValidator();
        await v.stake(baseStake);

        let r = await v.notifyReadyForCommittee();
        expect(r).to.have.a.committeeSnapshotEvent({
            addrs: [v.address]
        });

        r = await v.unstake(baseStake);
        expect(r).to.have.a.committeeSnapshotEvent({
            addrs: []
        });
    });

    it("tracks total governance stakes", async () => {
        const d = await Driver.new();
        async function expectTotalGovernanceStakeToBe(n) {
            expect(await d.elections.getTotalGovernanceStake()).to.be.bignumber.equal(bn(n));
        }

        const stakeOfA = 11;
        const stakeOfB = 13;
        const stakeOfC = 17;
        const stakeOfABC = stakeOfA+stakeOfB+stakeOfC;

        const a = d.newParticipant("delegating around"); // starts as self delegating
        const b = d.newParticipant("delegating to self - debating the amount");
        const c = d.newParticipant("delegating to a");
        await c.delegate(a);

        await a.stake(stakeOfA);
        await b.stake(stakeOfB);
        await c.stake(stakeOfC);

        await expectTotalGovernanceStakeToBe(stakeOfABC);

        await b.unstake(1);
        await expectTotalGovernanceStakeToBe(stakeOfABC - 1);

        await b.restake();
        await expectTotalGovernanceStakeToBe(stakeOfABC);

        await a.delegate(b); // delegate from self to a self delegating other
        await expectTotalGovernanceStakeToBe(stakeOfA + stakeOfB);

        await a.delegate(c); // delegate from self to a non-self delegating other
        await expectTotalGovernanceStakeToBe(stakeOfB);

        await a.delegate(a); // delegate to self back from a non-self delegating
        await expectTotalGovernanceStakeToBe(stakeOfABC);

        await a.delegate(c);
        await a.delegate(b); // delegate to another self delegating from a non-self delegating other
        await expectTotalGovernanceStakeToBe(stakeOfA + stakeOfB);

        await a.delegate(a); // delegate to self back from a self delegating other
        await expectTotalGovernanceStakeToBe(stakeOfABC);

    });

    it("tracks totalGovernanceStake correctly when assigning rewards", async () => {
        const d = await Driver.new();
        async function expectTotalGovernanceStakeToBe(n) {
            expect(await d.elections.getTotalGovernanceStake()).to.be.bignumber.equal(bn(n));
        }

        const stakeOfA = 11;
        const stakeOfB = 13;
        const stakeOfC = 17;
        const stakeOfABC = stakeOfA+stakeOfB+stakeOfC;

        const a = d.newParticipant("delegating around"); // starts as self delegating
        const b = d.newParticipant("delegating to self - debating the amount");
        const c = d.newParticipant("delegating to a");
        await c.delegate(a);

        await a.stake(stakeOfA);
        await b.stake(stakeOfB);
        await c.stake(stakeOfC);

        await expectTotalGovernanceStakeToBe(stakeOfABC);

        const rewards = [
            {p: d.newParticipant(), amount: 10, d: a},
            {p: d.newParticipant(), amount: 20, d: a},
            {p: d.newParticipant(), amount: 30, d: b},
            {p: d.newParticipant(), amount: 40, d: b},
            {p: d.newParticipant(), amount: 50, d: b},
            {p: d.newParticipant(), amount: 60, d: c},
            {p: d.newParticipant(), amount: 70, d: c}
        ];
        let totalRewardsForGovernanceStake = 0;
        for (let i = 0; i < rewards.length; i++) {
            await rewards[i].p.delegate(rewards[i].d);
            if (await d.delegations.getDelegation(rewards[i].d.address) == rewards[i].d.address) {
                totalRewardsForGovernanceStake += rewards[i].amount
            }
        }
        const rewardsTotal = rewards.map(i=>i.amount).reduce((a,b)=>a+b);
        await d.erc20.assign(a.address, rewardsTotal);
        await d.erc20.approve(d.staking.address, rewardsTotal, {from: a.address});
        let r = await d.staking.distributeRewards(rewardsTotal, rewards.map(r=>r.p.address), rewards.map(r=>r.amount), {from: a.address});

        await expectTotalGovernanceStakeToBe(stakeOfABC + totalRewardsForGovernanceStake);

        expect(r).to.have.a.delegatedStakeChangedEvent({
            addr: a.address,
            selfDelegatedStake: bn(stakeOfA),
            delegatedStake: bn(stakeOfA + stakeOfC + 30),
            delegators: [rewards[0].p.address, rewards[1].p.address],
            delegatorTotalStakes: [bn(rewards[0].amount), bn(rewards[1].amount)]
        });

        expect(r).to.have.a.delegatedStakeChangedEvent({
            addr: b.address,
            selfDelegatedStake: bn(stakeOfB),
            delegatedStake: bn(stakeOfB + 120),
            delegators: [rewards[2].p.address, rewards[3].p.address, rewards[4].p.address],
            delegatorTotalStakes: [bn(rewards[2].amount), bn(rewards[3].amount), bn(rewards[4].amount)]
        });


        expect(r).to.have.a.delegatedStakeChangedEvent({
            addr: c.address,
            selfDelegatedStake: bn(0),
            delegatedStake: bn(130),
            delegators: [rewards[5].p.address, rewards[6].p.address],
            delegatorTotalStakes: [bn(rewards[5].amount), bn(rewards[6].amount)]
        })
    });

    it("allows voting only to 3 at a time", async () => {
        const d = await Driver.new();

        let {thresholdCrossingIndex, delegatees, delegators, bannedValidator} = await banningScenario_setupDelegatorsAndValidators(d);

        // -------------- VOTE FOR 3 VALIDATORS AT MOST ---------------
        await expectRejected(d.elections.setBanningVotes(delegatees.slice(0, 4).map(v => v.address), {from: delegators[0].address}));
        await d.elections.setBanningVotes(delegatees.slice(0, 3).map(v => v.address), {from: delegators[0].address});
    });

    it("does not count delegators voting - because they don't have effective governance stake", async () => {
        const d = await Driver.new();

        let r;
        let {thresholdCrossingIndex, delegatees, delegators, bannedValidator} = await banningScenario_setupDelegatorsAndValidators(d);

        // -------------- BANNING VOTES CAST BY DELEGATORS - NO GOV STAKE, NO EFFECT ---------------
        for (const delegator of delegators) {
            r = await d.elections.setBanningVotes([bannedValidator.address], {from: delegator.address});
            expect(r).to.have.a.banningVoteEvent({
                voter: delegator.address,
                against: [bannedValidator.address]
            });
            expect(r).to.not.have.a.committeeSnapshotEvent();

            expect(r).to.not.have.a.bannedEvent();
        }
    });

    it("bans a validator only when accumulated votes stake reaches the threshold", async () => {
        const d = await Driver.new();

        let r;
        let {thresholdCrossingIndex, delegatees, delegators, bannedValidator} = await banningScenario_setupDelegatorsAndValidators(d);

        // -------------- CAST VOTES UNDER THE THRESHOLD ---------------

        for (let i = 0; i < thresholdCrossingIndex; i++) {
            const p = delegatees[i];
            r = await d.elections.setBanningVotes([bannedValidator.address], {from: p.address});
            expect(r).to.have.a.banningVoteEvent({
                voter: p.address,
                against: [bannedValidator.address]
            });
            expect(r).to.not.have.a.committeeSnapshotEvent();
            expect(r).to.not.have.a.bannedEvent();
            expect(r).to.not.have.a.unbannedEvent();
        }

        // -------------- ONE MORE VOTE TO REACH BANNING THRESHOLD ---------------

        r = await d.elections.setBanningVotes([bannedValidator.address], {from: delegatees[thresholdCrossingIndex].address}); // threshold is crossed
        expect(r).to.have.a.banningVoteEvent({
            voter: delegatees[thresholdCrossingIndex].address,
            against: [bannedValidator.address]
        });
        expect(r).to.have.a.bannedEvent({
            validator: bannedValidator.address
        });
        expect(r).to.have.a.committeeSnapshotEvent({
            addrs: []
        });
    });

    it("can revoke a vote and unban a validator as a result", async () => {
        const d = await Driver.new();

        let r;
        let {thresholdCrossingIndex, delegatees, delegators, bannedValidator} = await banningScenario_setupDelegatorsAndValidators(d);
        await banningScenario_voteUntilThresholdReached(d, thresholdCrossingIndex, delegatees, bannedValidator);

        // -------------- BANNING VOTES REVOKED BY VALIDATOR ---------------

        r = await d.elections.setBanningVotes([], {from: delegatees[thresholdCrossingIndex].address}); // threshold is again uncrossed
        expect(r).to.have.a.banningVoteEvent({
            voter: delegatees[thresholdCrossingIndex].address,
            against: []
        });
        expect(r).to.have.a.unbannedEvent({
            validator: bannedValidator.address
        });
        r = await bannedValidator.notifyReadyForCommittee();
        expect(r).to.have.a.committeeSnapshotEvent({
            addrs: [bannedValidator.address]
        })
    });

    it("banning does not responds to changes in staking, delegating or voting after locking (one week)", async () => {
        const d = await Driver.new();

        let r;
        let {thresholdCrossingIndex, delegatees, delegators, bannedValidator} = await banningScenario_setupDelegatorsAndValidators(d);
        await banningScenario_voteUntilThresholdReached(d, thresholdCrossingIndex, delegatees, bannedValidator);

        // ...*.* TiMe wArP *.*.....
        evmIncreaseTime(d.web3, BANNING_LOCK_TIMEOUT);

        // -----------------------------------------------------------------------------------
        // -------------- AFTER BANNING LOCKED - TRY TO UNBAN AND ALWAYS FAIL: ---------------
        // -----------------------------------------------------------------------------------

        // -------------- BANNING VOTES REVOKED BY VALIDATOR ---------------

        r = await d.elections.setBanningVotes([], {from: delegatees[thresholdCrossingIndex].address}); // threshold is again uncrossed
        expect(r).to.not.have.a.unbannedEvent();
        expect(r).to.not.have.a.committeeSnapshotEvent();

        // -------------- DELEGATOR UNSTAKES ---------------

        const tempStake = await d.staking.getStakeBalanceOf(delegators[thresholdCrossingIndex].address);
        r = await d.staking.unstake(tempStake, {from: delegators[thresholdCrossingIndex].address}); // threshold is un-crossed
        expect(r).to.not.have.a.unbannedEvent();
        expect(r).to.not.have.a.committeeSnapshotEvent();

        // -------------- NEW PARTICIPANT STAKES TO DILUTE BANNING VOTES ---------------

        const dilutingParticipant = d.newParticipant();
        const dilutingStake = 100 * defaultDriverOptions.banningThreshold * 200;
        await dilutingParticipant.stake(dilutingStake);
        expect(r).to.not.have.a.unbannedEvent(); // because we need a trigger to detect the change
        expect(r).to.not.have.a.committeeSnapshotEvent();

        // trigger - repeat an existing vote:
        const existingVotes = await d.elections.getBanningVotes(delegatees[0].address);
        r = await d.elections.setBanningVotes(existingVotes, {from: delegatees[0].address});

        expect(r).to.not.have.a.unbannedEvent();
        expect(r).to.not.have.a.committeeSnapshotEvent();

        // -------------- ATTEMPT UNBAN BY DELEGATION - VALIDATOR --------------
        const tipValidator = delegatees[thresholdCrossingIndex];

        const other = d.newParticipant();
        r = await d.delegations.delegate(other.address, {from: tipValidator.address}); // delegates to someone else
        expect(r).to.not.have.a.unbannedEvent();
        expect(r).to.not.have.a.committeeSnapshotEvent();

        // -------------- ATTEMPT UNBAN BY DELEGATION - DELEGATOR --------------
        const tipDelegator = delegators[thresholdCrossingIndex];

        r = await d.delegations.delegate(other.address, {from: tipDelegator.address}); // delegates to someone else
        expect(r).to.not.have.a.unbannedEvent();
        expect(r).to.not.have.a.committeeSnapshotEvent();
    });

    it("banning responds to changes in staking and delegating before locking", async () => {
        const d = await Driver.new();

        let r;
        let {thresholdCrossingIndex, delegatees, delegators, bannedValidator} = await banningScenario_setupDelegatorsAndValidators(d);
        await banningScenario_voteUntilThresholdReached(d, thresholdCrossingIndex, delegatees, bannedValidator);

        // -------------- DELEGATOR UNSTAKES AND RESTAKES TO REVOKE BANNING AND REINSTATE BAN ---------------

        const tempStake = await d.staking.getStakeBalanceOf(delegators[thresholdCrossingIndex].address);
        r = await d.staking.unstake(tempStake, {from: delegators[thresholdCrossingIndex].address}); // threshold is un-crossed
        expect(r).to.have.a.unbannedEvent({
            validator: bannedValidator.address
        });
        r = await bannedValidator.notifyReadyForCommittee();
        expect(r).to.have.a.committeeSnapshotEvent({
            addrs: [bannedValidator.address]
        })

        r = await d.staking.restake({from: delegators[thresholdCrossingIndex].address}); // threshold is crossed again
        expect(r).to.have.a.bannedEvent({
            validator: bannedValidator.address
        });
        expect(r).to.have.a.committeeSnapshotEvent({
            addrs: []
        });

        // -------------- NEW PARTICIPANT STAKES TO DILUTE BANNING VOTES, THEN UNSTAKES ---------------

        const dilutingParticipant = d.newParticipant();
        const dilutingStake = baseStake * defaultDriverOptions.banningThreshold * 200;
        r = await dilutingParticipant.stake(dilutingStake);
        expect(r).to.not.have.a.committeeSnapshotEvent();
        expect(r).to.not.have.a.bannedEvent();
        expect(r).to.not.have.a.unbannedEvent();

        // trigger - repeat an existing vote:
        const existingVotes = await d.elections.getBanningVotes(delegatees[0].address);
        r = await d.elections.setBanningVotes(existingVotes, {from: delegatees[0].address});
        expect(r).to.have.a.unbannedEvent({
            validator: bannedValidator.address
        });

        r = await bannedValidator.notifyReadyForCommittee();
        expect(r).to.have.a.committeeSnapshotEvent({
            addrs: [bannedValidator.address]
        });

        r = await d.staking.unstake(dilutingStake, {from: dilutingParticipant.address}); // threshold is again crossed
        expect(r).to.not.have.a.committeeSnapshotEvent(); // because we need a trigger to detect the change
        expect(r).to.not.have.a.bannedEvent();
        expect(r).to.not.have.a.unbannedEvent();

        // trigger - repeat an existing vote:
        r = await d.elections.setBanningVotes(existingVotes, {from: delegatees[0].address});

        expect(r).to.have.a.bannedEvent({
            validator: bannedValidator.address
        });
        expect(r).to.have.a.committeeSnapshotEvent({
            addrs: []
        });

        // -------------- UNBAN THEN BAN BY DELEGATION - VALIDATOR --------------
        const tipValidator = delegatees[thresholdCrossingIndex];

        const other = d.newParticipant();
        r = await d.delegations.delegate(other.address, {from: tipValidator.address}); // delegates to someone else
        expect(r).to.have.a.unbannedEvent({
            validator: bannedValidator.address
        });

        r = await bannedValidator.notifyReadyForCommittee();
        expect(r).to.have.a.committeeSnapshotEvent({
            addrs: [bannedValidator.address]
        });

        r = await d.delegations.delegate(tipValidator.address, {from: tipValidator.address}); // self delegation
        expect(r).to.have.a.bannedEvent({
            validator: bannedValidator.address
        });
        expect(r).to.have.a.committeeSnapshotEvent({
            addrs: []
        });

        // -------------- UNBAN THEN BAN BY DELEGATION - DELEGATOR --------------
        const tipDelegator = delegators[thresholdCrossingIndex];

        r = await d.delegations.delegate(other.address, {from: tipDelegator.address}); // delegates to someone else
        expect(r).to.have.a.unbannedEvent({
            validator: bannedValidator.address
        });

        r = await bannedValidator.notifyReadyForCommittee();
        expect(r).to.have.a.committeeSnapshotEvent({
            addrs: [bannedValidator.address]
        });

        r = await d.delegations.delegate(tipValidator.address, {from: tipDelegator.address}); // self delegation
        expect(r).to.have.a.bannedEvent({
            validator: bannedValidator.address
        });
        expect(r).to.have.a.committeeSnapshotEvent({
            addrs: []
        });
    });

    it("rejects readyToSync and readyForCommittee for a banned validator", async () => {
        const d = await Driver.new();

        let r;
        let {thresholdCrossingIndex, delegatees, delegators, bannedValidator} = await banningScenario_setupDelegatorsAndValidators(d);

        // -------------- CAST VOTES UNDER THE THRESHOLD ---------------

        for (let i = 0; i < thresholdCrossingIndex; i++) {
            const p = delegatees[i];
            r = await d.elections.setBanningVotes([bannedValidator.address], {from: p.address});
            expect(r).to.have.a.banningVoteEvent({
                voter: p.address,
                against: [bannedValidator.address]
            });
            expect(r).to.not.have.a.committeeSnapshotEvent();
            expect(r).to.not.have.a.standbysSnapshotEvent();
            expect(r).to.not.have.a.bannedEvent();
            expect(r).to.not.have.a.unbannedEvent();
        }

        // -------------- ONE MORE VOTE TO REACH BANNING THRESHOLD ---------------

        r = await d.elections.setBanningVotes([bannedValidator.address], {from: delegatees[thresholdCrossingIndex].address}); // threshold is crossed
        expect(r).to.have.a.banningVoteEvent({
            voter: delegatees[thresholdCrossingIndex].address,
            against: [bannedValidator.address]
        });
        expect(r).to.have.a.bannedEvent({
            validator: bannedValidator.address
        });
        expect(r).to.have.withinContract(d.committee).a.committeeSnapshotEvent({
            addrs: []
        });

        await expectRejected(d.elections.notifyReadyToSync({from: bannedValidator.address}));
        await expectRejected(d.elections.notifyReadyToSync({from: bannedValidator.orbsAddress}));
        await expectRejected(d.elections.notifyReadyForCommittee({from: bannedValidator.address}));
        await expectRejected(d.elections.notifyReadyForCommittee({from: bannedValidator.orbsAddress}));

        await d.elections.setBanningVotes([], {from: delegatees[thresholdCrossingIndex].address}); // threshold is crossed

        await d.elections.notifyReadyToSync({from: bannedValidator.address});
        await d.elections.notifyReadyToSync({from: bannedValidator.orbsAddress});
        await d.elections.notifyReadyForCommittee({from: bannedValidator.address});
        await d.elections.notifyReadyForCommittee({from: bannedValidator.orbsAddress});
    });

    it("sets and gets settings, only functional owner allowed to set", async () => {
        const d = await Driver.new();

        const current = await d.elections.getSettings();
        const voteOutTimeoutSeconds  = bn(current[0]);
        const maxDelegationRatio  = bn(current[1]);
        const banningLockTimeoutSeconds  = bn(current[2]);
        const voteOutPercentageThreshold  = bn(current[3]);
        const banningPercentageThreshold  = bn(current[4]);

        await expectRejected(d.elections.setVoteOutTimeoutSeconds(voteOutTimeoutSeconds.add(bn(1)), {from: d.migrationOwner.address}));
        let r = await d.elections.setVoteOutTimeoutSeconds(voteOutTimeoutSeconds.add(bn(1)), {from: d.functionalOwner.address});
        expect(r).to.have.a.voteOutTimeoutSecondsChangedEvent({
            newValue: voteOutTimeoutSeconds.add(bn(1)).toString(),
            oldValue: voteOutTimeoutSeconds.toString()
        });

        await expectRejected(d.elections.setMaxDelegationRatio(maxDelegationRatio.add(bn(1)), {from: d.migrationOwner.address}));
        r = await d.elections.setMaxDelegationRatio(maxDelegationRatio.add(bn(1)), {from: d.functionalOwner.address});
        expect(r).to.have.a.maxDelegationRatioChangedEvent({
            newValue: maxDelegationRatio.add(bn(1)).toString(),
            oldValue: maxDelegationRatio.toString()
        });

        await expectRejected(d.elections.setBanningLockTimeoutSeconds(banningLockTimeoutSeconds.add(bn(1)), {from: d.migrationOwner.address}));
        r = await d.elections.setBanningLockTimeoutSeconds(banningLockTimeoutSeconds.add(bn(1)), {from: d.functionalOwner.address});
        expect(r).to.have.a.banningLockTimeoutSecondsChangedEvent({
            newValue: banningLockTimeoutSeconds.add(bn(1)).toString(),
            oldValue: banningLockTimeoutSeconds.toString()
        });

        await expectRejected(d.elections.setVoteOutPercentageThreshold(voteOutPercentageThreshold.add(bn(1)), {from: d.migrationOwner.address}));
        r = await d.elections.setVoteOutPercentageThreshold(voteOutPercentageThreshold.add(bn(1)), {from: d.functionalOwner.address});
        expect(r).to.have.a.voteOutPercentageThresholdChangedEvent({
            newValue: voteOutPercentageThreshold.add(bn(1)).toString(),
            oldValue: voteOutPercentageThreshold.toString()
        });

        await expectRejected(d.elections.setBanningPercentageThreshold(banningPercentageThreshold.add(bn(1)), {from: d.migrationOwner.address}));
        r = await d.elections.setBanningPercentageThreshold(banningPercentageThreshold.add(bn(1)), {from: d.functionalOwner.address});
        expect(r).to.have.a.banningPercentageThresholdChangedEvent({
            newValue: banningPercentageThreshold.add(bn(1)).toString(),
            oldValue: banningPercentageThreshold.toString()
        });

        const afterUpdate = await d.elections.getSettings();
        expect([afterUpdate[0], afterUpdate[1], afterUpdate[2], afterUpdate[3], afterUpdate[4]]).to.deep.eq([
            voteOutTimeoutSeconds.add(bn(1)).toString(),
            maxDelegationRatio.add(bn(1)).toString(),
            banningLockTimeoutSeconds.add(bn(1)).toString(),
            voteOutPercentageThreshold.add(bn(1)).toString(),
            banningPercentageThreshold.add(bn(1)).toString()
        ]);
    })

});

export async function banningScenario_setupDelegatorsAndValidators(driver: Driver) {
    assert(defaultDriverOptions.banningThreshold < 98); // so each committee member will hold a positive stake
    assert(Math.floor(defaultDriverOptions.banningThreshold / 2) >= 98 - defaultDriverOptions.banningThreshold); // so the committee list will be ordered by stake

    // -------------- SETUP ---------------
    const stakesPercentage = [
        Math.ceil(defaultDriverOptions.banningThreshold / 2),
        Math.floor(defaultDriverOptions.banningThreshold / 2),
        98 - defaultDriverOptions.banningThreshold,
        1,
    ];
    const thresholdCrossingIndex = 1;
    const delegatees: Participant[] = [];
    const delegators: Participant[] = [];
    let totalStake = 0;
    for (const p of stakesPercentage) {
        // stake holders will not have own stake, only delegated - to test the use of governance stake
        const delegator = driver.newParticipant();

        const newStake = baseStake * p;
        totalStake += newStake;

        await delegator.stake(newStake);
        expect(await driver.elections.getTotalGovernanceStake()).to.be.bignumber.equal(bn(totalStake));

        const v = driver.newParticipant();
        await delegator.delegate(v);
        expect(await driver.elections.getTotalGovernanceStake()).to.be.bignumber.equal(bn(totalStake));

        delegatees.push(v);
        delegators.push(delegator);
    }

    const bannedValidator = delegatees[delegatees.length - 1];
    await bannedValidator.registerAsValidator();

    await bannedValidator.stake(baseStake);
    let r = await bannedValidator.notifyReadyForCommittee();
    expect(r).to.have.a.committeeSnapshotEvent({
        addrs: [bannedValidator.address]
    });

    return {thresholdCrossingIndex, delegatees, delegators, bannedValidator};
}

export async function banningScenario_voteUntilThresholdReached(driver: Driver, thresholdCrossingIndex, delegatees, bannedValidator) {
    let r;
    for (let i = 0; i <= thresholdCrossingIndex; i++) {
        const p = delegatees[i];
        r = await driver.elections.setBanningVotes([bannedValidator.address], {from: p.address});
    }
    expect(r).to.have.a.banningVoteEvent({
        voter: delegatees[thresholdCrossingIndex].address,
        against: [bannedValidator.address]
    });
    expect(r).to.have.a.bannedEvent({
        validator: bannedValidator.address
    });
    expect(r).to.have.a.committeeSnapshotEvent({
        addrs: []
    });
    return r;
}
