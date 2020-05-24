import 'mocha';

import * as _ from "lodash";
import Web3 from "web3";
declare const web3: Web3;

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

import {bn, evmIncreaseTime} from "./helpers";
import {ETHEREUM_URL, Web3Driver} from "../eth";
import {
    committeeChangedEvents,
    delegatedEvents,
    stakedEvents,
    stakeChangedEvents
} from "./event-parsing";

const baseStake = 100;

describe('elections-high-level-flows', async () => {

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

        const d = await Driver.new({maxCommitteeSize: 2, maxStandbys: 2});

        // First validator registers
        const validatorStaked100 = d.newParticipant();
        let r = await validatorStaked100.stake(stake100);
        expect(r).to.have.a.stakedEvent();

        r = await validatorStaked100.registerAsValidator();
        expect(r).to.have.a.validatorRegisteredEvent({
            addr: validatorStaked100.address,
            ip: validatorStaked100.ip
        });
        r = await validatorStaked100.notifyReadyToSync();
        expect(r).to.have.a.standbysChangedEvent({
            addrs: [validatorStaked100.address],
            orbsAddrs: [validatorStaked100.orbsAddress],
            weights: [stake100]
        });
        expect(r).to.not.have.a.committeeChangedEvent();

        r = await validatorStaked100.notifyReadyForCommittee();
        expect(r).to.have.a.committeeChangedEvent({
            addrs: [validatorStaked100.address],
            orbsAddrs: [validatorStaked100.orbsAddress],
            weights: [stake100],
        });
        expect(r).to.have.a.standbysChangedEvent({
            addrs: [],
            orbsAddrs: [],
            weights: []
        });

        const validatorStaked200 = d.newParticipant();
        r = await validatorStaked200.stake(stake200);
        expect(r).to.have.a.stakeChangedEvent({addr: validatorStaked200.address, committeeStake: stake200});

        r = await validatorStaked200.registerAsValidator();
        expect(r).to.have.a.validatorRegisteredEvent({
            addr: validatorStaked200.address,
            ip: validatorStaked200.ip,
        });

        r = await validatorStaked200.notifyReadyToSync();
        expect(r).to.have.a.standbysChangedEvent({
            addrs: [validatorStaked200.address],
            orbsAddrs: [validatorStaked200.orbsAddress],
            weights: [stake200]
        });
        expect(r).to.not.have.a.committeeChangedEvent();

        r = await validatorStaked200.notifyReadyForCommittee();
        expect(r).to.have.a.committeeChangedEvent({
            addrs: [validatorStaked200.address, validatorStaked100.address],
            orbsAddrs: [validatorStaked200.orbsAddress, validatorStaked100.orbsAddress],
            weights: [stake200, stake100]
        });
        expect(r).to.have.a.standbysChangedEvent({
            addrs: [],
            orbsAddrs: [],
            weights: []
        });

        // A third validator registers high ranked

        const validatorStaked300 = d.newParticipant();
        r = await validatorStaked300.stake(stake300);
        expect(r).to.have.a.stakedEvent();

        r = await validatorStaked300.registerAsValidator();
        expect(r).to.have.a.validatorRegisteredEvent({
            addr: validatorStaked300.address,
            ip: validatorStaked300.ip
        });
        r = await validatorStaked300.notifyReadyToSync();
        expect(r).to.have.a.standbysChangedEvent({
            addrs: [validatorStaked300.address],
            orbsAddrs: [validatorStaked300.orbsAddress],
            weights: [stake300]
        });
        expect(r).to.not.have.a.committeeChangedEvent();

        r = await validatorStaked300.notifyReadyForCommittee();
        expect(r).to.have.a.committeeChangedEvent({
            addrs: [validatorStaked300.address, validatorStaked200.address],
            orbsAddrs: [validatorStaked300.orbsAddress, validatorStaked200.orbsAddress],
            weights: [stake300, stake200]
        });
        expect(r).to.have.a.standbysChangedEvent({
            addrs: [validatorStaked100.address],
            orbsAddrs: [validatorStaked100.orbsAddress],
            weights: [stake100]
        });

        r = await d.delegateMoreStake(stake300, validatorStaked200);
        expect(r).to.have.a.committeeChangedEvent({
            addrs: [validatorStaked200.address, validatorStaked300.address],
            orbsAddrs: [validatorStaked200.orbsAddress, validatorStaked300.orbsAddress],
            weights: [stake200.add(stake300), stake300]
        });
        expect(r).to.not.have.a.standbysChangedEvent();

        r = await d.delegateMoreStake(stake500, validatorStaked100);
        expect(r).to.have.a.committeeChangedEvent({
            addrs: [validatorStaked100.address, validatorStaked200.address],
            orbsAddrs: [validatorStaked100.orbsAddress, validatorStaked200.orbsAddress],
            weights: [stake100.add(stake500), stake500]
        });
        expect(r).to.have.a.standbysChangedEvent({
            addrs: [validatorStaked300.address],
            orbsAddrs: [validatorStaked300.orbsAddress],
            weights: [stake300]
        });

        // A new validator registers, stakes and enters the topology

        const inTopologyValidator = d.newParticipant();
        r = await inTopologyValidator.stake(stake100);
        expect(r).to.have.a.stakedEvent();
        await inTopologyValidator.registerAsValidator();
        r = await inTopologyValidator.notifyReadyToSync();
        expect(r).to.have.a.standbysChangedEvent({
            addrs: [validatorStaked300.address, inTopologyValidator.address],
            orbsAddrs: [validatorStaked300.orbsAddress, inTopologyValidator.orbsAddress],
            weights: [stake300, stake100]
        });
        expect(r).to.not.have.a.committeeChangedEvent();

        r = await inTopologyValidator.notifyReadyForCommittee();
        expect(r).to.not.have.a.committeeChangedEvent();

        // The bottom validator in the topology delegates more stake and switches places with the second to last
        r = await d.delegateMoreStake(201, inTopologyValidator);
        expect(r).to.not.have.a.committeeChangedEvent(); // no change in the committee
        expect(r).to.have.a.standbysChangedEvent({ // standbys change order
            addrs: [inTopologyValidator.address, validatorStaked300.address],
            orbsAddrs: [inTopologyValidator.orbsAddress, validatorStaked300.orbsAddress],
            weights: [stake100.addn(201), stake300]
        });

        // A new validator registers and stakes but does not enter the topology
        const outOfTopologyValidator = d.newParticipant();
        r = await outOfTopologyValidator.stake(stake100);
        expect(r).to.have.a.stakedEvent();
        r = await outOfTopologyValidator.registerAsValidator();
        r = await outOfTopologyValidator.notifyReadyToSync();
        expect(r).to.not.have.a.standbysChangedEvent();
        r = await outOfTopologyValidator.notifyReadyForCommittee();
        expect(r).to.not.have.a.committeeChangedEvent();

        // A new validator stakes enough to get to the top
        const validator = d.newParticipant();
        await validator.registerAsValidator();
        await validator.notifyReadyForCommittee();
        r = await validator.stake(stake1000); // now top of committee
        expect(r).to.have.a.committeeChangedEvent({
            addrs: [validator.address, validatorStaked100.address],
            orbsAddrs: [validator.orbsAddress, validatorStaked100.orbsAddress],
            weights: [stake1000, stake100.add(stake500)]
        });
        expect(r).to.have.a.standbysChangedEvent({
            addrs: [validatorStaked200.address, inTopologyValidator.address],
            orbsAddrs: [validatorStaked200.orbsAddress, inTopologyValidator.orbsAddress],
            weights: [stake500, stake100.addn(201)]
        });

        r = await validator.unstake(501); // becomes a standby
        expect(r).to.have.a.committeeChangedEvent({
            addrs: [validatorStaked100.address, validatorStaked200.address],
            orbsAddrs: [validatorStaked100.orbsAddress, validatorStaked200.orbsAddress],
            weights: [stake100.add(stake500), stake500]
        });
        expect(r).to.have.a.standbysChangedEvent({
            addrs: [validator.address, inTopologyValidator.address],
            orbsAddrs: [validator.orbsAddress, inTopologyValidator.orbsAddress],
            weights: [bn(499), stake100.addn(201)]
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

        const d = await Driver.new({maxCommitteeSize: committeeSize, maxStandbys: 1});

        let r;
        const committee: Participant[] = [];
        for (const p of stakesPercentage) {
            const v = d.newParticipant();
            await v.registerAsValidator();
            await v.notifyReadyForCommittee();
            r = await v.stake(baseStake * p);
            committee.push(v);
        }
        expect(r).to.have.a.committeeChangedEvent({
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
                expect(r).to.not.have.a.committeeChangedEvent();
            }

            r = await d.elections.voteOut(votedOutValidator.address, {from: committee[thresholdCrossingIndex].orbsAddress}); // Threshold is reached
            expect(r).to.have.a.voteOutEvent({
                voter: committee[thresholdCrossingIndex].address,
                against: votedOutValidator.address
            });
            expect(r).to.have.a.votedOutOfCommitteeEvent({
                addr: votedOutValidator.address
            });
            expect(r).to.have.a.committeeChangedEvent({
                addrs: committee.filter(v => v != votedOutValidator).map(v => v.address)
            });
            expect(r).to.not.have.a.standbysChangedEvent(); // should not become a standby

            // voted-out validator re-joins by notifying ready-for-committee
            r = await votedOutValidator.notifyReadyForCommittee();
            expect(r).to.have.a.committeeChangedEvent({
                addrs: committee.map(v => v.address)
            });
            expect(r).to.not.have.a.standbysChangedEvent();
        }
    });

    it('discards stale votes', async () => {
        assert(defaultDriverOptions.voteOutThreshold > 50); // so one out of two equal committee members does not cross the threshold

        const committeeSize = 2;
        const d = await Driver.new({maxCommitteeSize: committeeSize, maxStandbys: 1});

        let r;
        const committee: Participant[] = [];
        for (let i = 0; i < committeeSize; i++) {
            const v = d.newParticipant();
            await v.registerAsValidator();
            await v.notifyReadyForCommittee();
            r = await v.stake(100);
            committee.push(v);
        }
        expect(r).to.have.a.committeeChangedEvent({
            orbsAddrs: committee.map(v => v.orbsAddress)
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
        expect(r).to.not.have.a.committeeChangedEvent();

        // recast the stale vote-out, threshold should be reached
        r = await d.elections.voteOut(committee[1].address, {from: committee[0].orbsAddress});
        expect(r).to.have.a.voteOutEvent({
            voter: committee[0].address,
            against: committee[1].address,
        });
        expect(r).to.have.a.votedOutOfCommitteeEvent({
            addr: committee[1].address
        });
        expect(r).to.have.a.committeeChangedEvent({
            addrs: [committee[0].address]
        });
    });

    it('does not elect without registration', async () => {
        const d = await Driver.new();

        const V1_STAKE = 100;

        const v = d.newParticipant();
        const r = await v.stake(V1_STAKE);
        expect(r).to.not.have.a.committeeChangedEvent();
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
        const d = await Driver.new({maxCommitteeSize: 2, maxStandbys: 1, maxDelegationRatio: 10});

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
        expect(r).to.have.a.committeeChangedEvent({
            addrs: [v1.address],
            weights: [new BN(1000)]
        });

        r = await v1.stake(2);
        expect(r).to.have.a.stakeChangedEvent({
            addr: v1.address,
            committeeStake: new BN(1012),
        });
        expect(r).to.have.a.committeeChangedEvent({
            addrs: [v1.address],
            weights: [new BN(1012)]
        });

        r = await v2.stake(30);
        expect(r).to.have.a.stakeChangedEvent({
            addr: v1.address,
            committeeStake: new BN(1020),
        });
        expect(r).to.have.a.committeeChangedEvent({
            addrs: [v1.address],
            weights: [new BN(1020)]
        });

        r = await v1.stake(1);
        expect(r).to.have.a.stakeChangedEvent({
            addr: v1.address,
            committeeStake: new BN(1030),
        });
        expect(r).to.have.a.committeeChangedEvent({
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

        expect(r).to.have.a.committeeChangedEvent({ // Make sure v1 does not enter the committee
            addrs: [v2.address],
        })
    });

    it('ensures a non-ready validator cannot join the committee even when owning enough stake', async () => {
        const d = await Driver.new();
        const v = d.newParticipant();
        await v.stake(baseStake);
        await v.registerAsValidator();
        let r = await v.notifyReadyToSync();
        expect(r).to.have.a.standbysChangedEvent({
            addrs: [v.address],
        });
        expect(r).to.not.have.a.committeeChangedEvent();

        r = await v.notifyReadyForCommittee();
        expect(r).to.have.a.committeeChangedEvent({
            orbsAddrs: [v.orbsAddress]
        });
    });

    it('publishes a CommiteeChangedEvent when the commitee becomes empty', async () => {
        const d = await Driver.new();
        const v = d.newParticipant();
        await v.registerAsValidator();
        await v.stake(baseStake);

        let r = await v.notifyReadyForCommittee();
        expect(r).to.have.a.committeeChangedEvent({
            addrs: [v.address]
        });

        r = await v.unstake(baseStake);
        expect(r).to.have.a.committeeChangedEvent({
            addrs: []
        });
    });

    it('ignores ReadyForCommittee state when electing candidates', async () => {
        const d = await Driver.new();
        let r;

        const topology: Participant[] = [];
        for (let i = defaultDriverOptions.maxStandbys + defaultDriverOptions.maxCommitteeSize; i > 0; i--) {
            const v = d.newParticipant();
            await v.registerAsValidator();
            await v.stake(baseStake * i);
            r = await v.notifyReadyForCommittee();
            topology.push(v);
            if (topology.length == defaultDriverOptions.maxCommitteeSize) {
                expect(r).to.have.a.committeeChangedEvent({
                    addrs: topology.map(v => v.address)
                });
            }
        }
        expect(r).to.have.a.standbysChangedEvent({
            addrs: topology.slice(defaultDriverOptions.maxCommitteeSize).map(v => v.address)
        });

        const newValidator = d.newParticipant();
        r = await newValidator.registerAsValidator();
        r = await newValidator.stake(baseStake * 2);
        r = await newValidator.notifyReadyToSync();
        expect(r).to.have.a.standbysChangedEvent({
            addrs: topology.slice(defaultDriverOptions.maxCommitteeSize, topology.length - 1).map(v => v.address).concat(newValidator.address)
        });

        const newValidator2 = d.newParticipant();
        await newValidator2.registerAsValidator();
        await newValidator2.stake(baseStake);
        r = await newValidator2.notifyReadyForCommittee();
        expect(r).to.not.have.a.standbysChangedEvent();
        expect(r).to.not.have.a.committeeChangedEvent();
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
            expect(r).to.not.have.a.committeeChangedEvent();
            expect(r).to.not.have.a.standbysChangedEvent();
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
            expect(r).to.not.have.a.committeeChangedEvent();
            expect(r).to.not.have.a.standbysChangedEvent();
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
        expect(r).to.have.withinContract(d.committee).a.committeeChangedEvent({
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
        r = await bannedValidator.notifyReadyToSync();
        expect(r).to.have.a.standbysChangedEvent({
            addrs: [bannedValidator.address]
        });
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
        expect(r).to.not.have.a.committeeChangedEvent();
        expect(r).to.not.have.a.standbysChangedEvent();

        // -------------- DELEGATOR UNSTAKES ---------------

        const tempStake = await d.staking.getStakeBalanceOf(delegators[thresholdCrossingIndex].address);
        r = await d.staking.unstake(tempStake, {from: delegators[thresholdCrossingIndex].address}); // threshold is un-crossed
        expect(r).to.not.have.a.unbannedEvent();
        expect(r).to.not.have.a.committeeChangedEvent();
        expect(r).to.not.have.a.standbysChangedEvent();

        // -------------- NEW PARTICIPANT STAKES TO DILUTE BANNING VOTES ---------------

        const dilutingParticipant = d.newParticipant();
        const dilutingStake = 100 * defaultDriverOptions.banningThreshold * 200;
        await dilutingParticipant.stake(dilutingStake);
        expect(r).to.not.have.a.unbannedEvent(); // because we need a trigger to detect the change
        expect(r).to.not.have.a.committeeChangedEvent();
        expect(r).to.not.have.a.standbysChangedEvent();

        // trigger - repeat an existing vote:
        const existingVotes = await d.elections.getBanningVotes(delegatees[0].address);
        r = await d.elections.setBanningVotes(existingVotes, {from: delegatees[0].address});

        expect(r).to.not.have.a.unbannedEvent();
        expect(r).to.not.have.a.committeeChangedEvent();
        expect(r).to.not.have.a.standbysChangedEvent();

        // -------------- ATTEMPT UNBAN BY DELEGATION - VALIDATOR --------------
        const tipValidator = delegatees[thresholdCrossingIndex];

        const other = d.newParticipant();
        r = await d.delegations.delegate(other.address, {from: tipValidator.address}); // delegates to someone else
        expect(r).to.not.have.a.unbannedEvent();
        expect(r).to.not.have.a.committeeChangedEvent();
        expect(r).to.not.have.a.standbysChangedEvent();

        // -------------- ATTEMPT UNBAN BY DELEGATION - DELEGATOR --------------
        const tipDelegator = delegators[thresholdCrossingIndex];

        r = await d.delegations.delegate(other.address, {from: tipDelegator.address}); // delegates to someone else
        expect(r).to.not.have.a.unbannedEvent();
        expect(r).to.not.have.a.committeeChangedEvent();
        expect(r).to.not.have.a.standbysChangedEvent();
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
        r = await bannedValidator.notifyReadyToSync();
        expect(r).to.have.a.standbysChangedEvent({
            addrs: [bannedValidator.address]
        });

        r = await d.staking.restake({from: delegators[thresholdCrossingIndex].address}); // threshold is crossed again
        expect(r).to.have.a.bannedEvent({
            validator: bannedValidator.address
        });
        expect(r).to.have.a.standbysChangedEvent({
            addrs: []
        });

        // -------------- NEW PARTICIPANT STAKES TO DILUTE BANNING VOTES, THEN UNSTAKES ---------------

        const dilutingParticipant = d.newParticipant();
        const dilutingStake = baseStake * defaultDriverOptions.banningThreshold * 200;
        r = await dilutingParticipant.stake(dilutingStake);
        expect(r).to.not.have.a.standbysChangedEvent(); // because we need a trigger to detect the change
        expect(r).to.not.have.a.committeeChangedEvent();
        expect(r).to.not.have.a.bannedEvent();
        expect(r).to.not.have.a.unbannedEvent();

        // trigger - repeat an existing vote:
        const existingVotes = await d.elections.getBanningVotes(delegatees[0].address);
        r = await d.elections.setBanningVotes(existingVotes, {from: delegatees[0].address});
        expect(r).to.have.a.unbannedEvent({
            validator: bannedValidator.address
        });

        r = await bannedValidator.notifyReadyToSync();
        expect(r).to.have.a.standbysChangedEvent({
            addrs: [bannedValidator.address]
        });

        r = await d.staking.unstake(dilutingStake, {from: dilutingParticipant.address}); // threshold is again crossed
        expect(r).to.not.have.a.committeeChangedEvent(); // because we need a trigger to detect the change
        expect(r).to.not.have.a.standbysChangedEvent(); // because we need a trigger to detect the change
        expect(r).to.not.have.a.bannedEvent();
        expect(r).to.not.have.a.unbannedEvent();

        // trigger - repeat an existing vote:
        r = await d.elections.setBanningVotes(existingVotes, {from: delegatees[0].address});

        expect(r).to.have.a.bannedEvent({
            validator: bannedValidator.address
        });
        expect(r).to.have.a.standbysChangedEvent({
            addrs: []
        });

        // -------------- UNBAN THEN BAN BY DELEGATION - VALIDATOR --------------
        const tipValidator = delegatees[thresholdCrossingIndex];

        const other = d.newParticipant();
        r = await d.delegations.delegate(other.address, {from: tipValidator.address}); // delegates to someone else
        expect(r).to.have.a.unbannedEvent({
            validator: bannedValidator.address
        });

        r = await bannedValidator.notifyReadyToSync();
        expect(r).to.have.a.standbysChangedEvent({
            addrs: [bannedValidator.address]
        });

        r = await d.delegations.delegate(tipValidator.address, {from: tipValidator.address}); // self delegation
        expect(r).to.have.a.bannedEvent({
            validator: bannedValidator.address
        });
        expect(r).to.have.a.standbysChangedEvent({
            addrs: []
        });

        // -------------- UNBAN THEN BAN BY DELEGATION - DELEGATOR --------------
        const tipDelegator = delegators[thresholdCrossingIndex];

        r = await d.delegations.delegate(other.address, {from: tipDelegator.address}); // delegates to someone else
        expect(r).to.have.a.unbannedEvent({
            validator: bannedValidator.address
        });

        r = await bannedValidator.notifyReadyToSync();
        expect(r).to.have.a.standbysChangedEvent({
            addrs: [bannedValidator.address]
        });

        r = await d.delegations.delegate(tipValidator.address, {from: tipDelegator.address}); // self delegation
        expect(r).to.have.a.bannedEvent({
            validator: bannedValidator.address
        });
        expect(r).to.have.a.standbysChangedEvent({
            addrs: []
        });
    });

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
    for (const p of stakesPercentage) {
        // stake holders will not have own stake, only delegated - to test the use of governance stake
        const delegator = driver.newParticipant();
        await delegator.stake(baseStake * p);
        const v = driver.newParticipant();
        await delegator.delegate(v);
        delegatees.push(v);
        delegators.push(delegator);
    }

    const bannedValidator = delegatees[delegatees.length - 1];
    await bannedValidator.registerAsValidator();
    await bannedValidator.stake(baseStake);
    let r = await bannedValidator.notifyReadyForCommittee();
    expect(r).to.have.a.committeeChangedEvent({
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
    expect(r).to.withinContract(driver.committee).have.a.committeeChangedEvent({
        orbsAddrs: []
    });
    return r;
}
