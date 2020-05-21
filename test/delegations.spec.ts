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

import {bn} from "./helpers";
import {TransactionReceipt} from "web3-core";

const baseStake = 100;

describe('delegations-contract', async () => {


    it('should only accept stake notifications from the staking contract', async () => {
        const d = await Driver.new();

        const rogueStakingContract = await d.newStakingContract(d.delegations.address, d.erc20.address);

        const participant = d.newParticipant();

        await expectRejected(participant.stake(5, rogueStakingContract), "should not accept notifications from an address other than the staking contract");
        await participant.stake(5);
        await d.contractRegistry.set("staking", rogueStakingContract.address);
        await participant.stake(5, rogueStakingContract)

        // TODO - to check stakeChangeBatch use a mock staking contract that would satisfy the interface but would allow sending stakeChangeBatch when there are no rewards to distribue
        // await expectRejected(d.delegations.stakeChangeBatch([d.accounts[0]], [1], [true], [1], {from: nonStakingAddr}), "should not accept notifications from an address other than the staking contract");
        // await d.delegations.stakeChangeBatch([d.accounts[0]], [1], [true], [1], {from: stakingAddr});
    });

    it('selfDelegatedStake toggles to zero if delegating to another', async () => {
        const d = await Driver.new();

        const p1 = d.newParticipant();
        let r = await p1.stake(100);
        expect(r).to.have.a.delegatedStakeChangedEvent({
            addr: p1.address,
            selfDelegatedStake: bn(100),
            delegatedStake: bn(100),
            delegators: [p1.address],
            delegatorTotalStakes: [bn(100)]
        });

        const p2 = d.newParticipant();
        r = await p1.delegate(p2);
        expect(r).to.have.a.delegatedStakeChangedEvent({
            addr: p1.address,
            selfDelegatedStake: bn(0),
            delegatedStake: bn(0),
            delegators: [p1.address],
            delegatorTotalStakes: [bn(0)]
        });
        expect(r).to.have.a.delegatedStakeChangedEvent({
            addr: p2.address,
            selfDelegatedStake: bn(0),
            delegatedStake: bn(100),
            delegators: [p1.address],
            delegatorTotalStakes: [bn(100)]
        });

        r = await p1.delegate(p1);
        expect(r).to.have.a.delegatedStakeChangedEvent({
            addr: p1.address,
            selfDelegatedStake: bn(100),
            delegatedStake: bn(100),
            delegators: [p1.address],
            delegatorTotalStakes: [bn(100)]
        });
    });

    it('emits DelegatedStakeChanged and Delegated on delegation changes', async () => {
        const d = await Driver.new();

        const p1 = d.newParticipant();
        let r = await p1.stake(100);
        expect(r).to.have.a.delegatedStakeChangedEvent({
            addr: p1.address,
            selfDelegatedStake: bn(100),
            delegatedStake: bn(100),
            delegators: [p1.address],
            delegatorTotalStakes: [bn(100)]
        });

        const p2 = d.newParticipant();
        r = await p2.delegate(p1);
        expect(r).to.have.a.delegatedEvent({
            from: p2.address,
            to: p1.address
        });
        expect(r).to.not.have.a.delegatedStakeChangedEvent();

        r = await p2.stake(100);
        expect(r).to.have.a.delegatedStakeChangedEvent({
            addr: p1.address,
            selfDelegatedStake: bn(100),
            delegatedStake: bn(200),
            delegators: [p2.address],
            delegatorTotalStakes: [bn(100)]
        });

        r = await p2.stake(11);
        expect(r).to.have.a.delegatedStakeChangedEvent({
            addr: p1.address,
            selfDelegatedStake: bn(100),
            delegatedStake: bn(211),
            delegators: [p2.address],
            delegatorTotalStakes: [bn(111)]
        });

        const p3 = d.newParticipant();
        await p3.stake(100);
        r = await p3.delegate(p1);
        expect(r).to.have.a.delegatedEvent({
            from: p3.address,
            to: p1.address
        });
        expect(r).to.have.a.delegatedStakeChangedEvent({
            addr: p3.address,
            selfDelegatedStake: bn(0),
            delegatedStake: bn(0),
            delegators: [p3.address],
            delegatorTotalStakes: [bn(0)]
        });
        expect(r).to.have.a.delegatedStakeChangedEvent({
            addr: p1.address,
            selfDelegatedStake: bn(100),
            delegatedStake: bn(311),
            delegators: [p3.address],
            delegatorTotalStakes: [bn(100)]
        });

        const p4 = d.newParticipant();
        p4.stake(100);
        expect(await d.delegations.getDelegation(p4.address)).to.equal(p4.address);

        await d.erc20.assign(d.accounts[0], 1000);
        await d.erc20.approve(d.staking.address, 1000, {from: d.accounts[0]});
        r = await d.staking.distributeRewards(
            1000,
            [p1.address, p2.address, p3.address, p4.address],
            [100, 200, 300, 400]
        );
        expect(r).to.have.a.delegatedStakeChangedEvent({
            addr: p1.address,
            selfDelegatedStake: bn(200),
            delegatedStake: bn(911),
            delegators: [p1.address, p2.address, p3.address],
            delegatorTotalStakes: [bn(200), bn(311), bn(400)]
        });
        expect(r).to.have.a.delegatedStakeChangedEvent({
            addr: p4.address,
            selfDelegatedStake: bn(500),
            delegatedStake: bn(500),
            delegators: [p4.address],
            delegatorTotalStakes: [bn(500)]
        });

        await d.erc20.assign(d.accounts[0], 300);
        await d.erc20.approve(d.staking.address, 300, {from: d.accounts[0]});
        r = await d.staking.distributeRewards(
            300,
            [p1.address, p2.address, p3.address],
            [100, 100, 100]
        );
        expect(r).to.have.a.delegatedStakeChangedEvent({
            addr: p1.address,
            selfDelegatedStake: bn(300),
            delegatedStake: bn(1211),
            delegators: [p1.address, p2.address, p3.address],
            delegatorTotalStakes: [bn(300), bn(411), bn(500)]
        });

    });

    it('when delegating to another, DelegatedStakeChanged should indicate a new delegation of 0 to the previous delegate', async () => {
        const d = await Driver.new();

        let r: TransactionReceipt;

        const v1 = d.newParticipant();
        const v2 = d.newParticipant();
        const d1 = d.newParticipant();

        await d1.stake(100);
        r = await d1.delegate(v1);
        expect(r).to.have.a.delegatedStakeChangedEvent({
            addr: v1.address,
            delegators: [d1.address],
            delegatorTotalStakes: [bn(100)]
        });

        r = await d1.delegate(v2);
        expect(r).to.have.a.delegatedStakeChangedEvent({
            addr: v2.address,
            delegators: [d1.address],
            delegatorTotalStakes: [bn(100)]
        });
        expect(r).to.have.a.delegatedStakeChangedEvent({
            addr: v1.address,
            delegators: [d1.address],
            delegatorTotalStakes: [bn(0)]
        });
    });
});
