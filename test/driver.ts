import BN from "bn.js";
import chai from "chai";
chai.use(require('chai-bn')(BN));

export const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

import { ElectionsContract } from "../typings/elections-contract";
import { ERC20Contract } from "../typings/erc20-contract";
import { StakingContract } from "../typings/staking-contract";
import { MonthlySubscriptionPlanContract } from "../typings/monthly-subscription-plan-contract";
import {ContractRegistryContract} from "../typings/contract-registry-contract";
import { Contracts } from "../typings/contracts";
import { Web3Driver, defaultWeb3Provider } from "../eth";
import Web3 from "web3";
import {ValidatorsRegistrationContract} from "../typings/validator-registration-contract";
import {ComplianceContract} from "../typings/compliance-contract";

export const BANNING_LOCK_TIMEOUT = 7*24*60*60;
export const DEPLOYMENT_SUBSET_MAIN = "main";
export const DEPLOYMENT_SUBSET_CANARY = "canary";
export const CONFORMANCE_TYPE_GENERAL = "General";
export const CONFORMANCE_TYPE_COMPLIANCE = "Compliance";

export type DriverOptions = {
    minCommitteeSize: number,
    maxCommitteeSize: number;
    generalCommitteeMinimumWeight: number,
    maxStandbys: number;
    maxDelegationRatio: number;
    voteOutThreshold: number;
    voteOutTimeout: number;
    readyToSyncTimeout: number;
    banningThreshold: number;
    web3Provider : () => Web3;
}
export const defaultDriverOptions: Readonly<DriverOptions> = {
    minCommitteeSize: 0,
    maxCommitteeSize: 2,
    generalCommitteeMinimumWeight: 0,
    maxStandbys : 2,
    maxDelegationRatio : 10,
    voteOutThreshold : 80,
    voteOutTimeout : 24 * 60 * 60,
    readyToSyncTimeout: 7*24*60*60,
    banningThreshold : 80,
    web3Provider: defaultWeb3Provider,
};
export class Driver {
    private static web3DriversCache = new WeakMap<DriverOptions['web3Provider'], Web3Driver>();
    private participants: Participant[] = [];

    constructor(
        public web3: Web3Driver,
        public accounts: string[],
        public elections: Contracts["Elections"],
        public erc20: Contracts["TestingERC20"],
        public externalToken: Contracts["TestingERC20"],
        public staking: Contracts["StakingContract"],
        public subscriptions: Contracts["Subscriptions"],
        public bootstrapRewards: Contracts["BootstrapRewards"],
        public stakingRewards: Contracts["StakingRewards"],
        public fees: Contracts["Fees"],
        public protocol: Contracts["Protocol"],
        public compliance: Contracts["Compliance"],
        public validatorsRegistration: Contracts['ValidatorsRegistration'],
        public committeeGeneral: Contracts['Committee'],
        public committeeCompliance: Contracts['Committee'],
        public contractRegistry: Contracts["ContractRegistry"],
    ) {}

    static async new(options: Partial<DriverOptions> = {}): Promise<Driver> {
        const {
            minCommitteeSize, maxCommitteeSize, generalCommitteeMinimumWeight, maxStandbys,
            maxDelegationRatio, voteOutThreshold, voteOutTimeout, banningThreshold, web3Provider,
            readyToSyncTimeout
        } = Object.assign({}, defaultDriverOptions, options);
        const web3 = Driver.web3DriversCache.get(web3Provider) || new Web3Driver(web3Provider);
        Driver.web3DriversCache.set(web3Provider, web3);
        const accounts = await web3.eth.getAccounts();

        const contractRegistry = await web3.deploy( 'ContractRegistry',[accounts[0]]);
        const externalToken = await web3.deploy( 'TestingERC20', []);
        const erc20 = await web3.deploy( 'TestingERC20', []);
        const bootstrapRewards = await web3.deploy( 'BootstrapRewards', [externalToken.address, accounts[0]]);
        const stakingRewards = await web3.deploy( 'StakingRewards', [erc20.address, accounts[0]]);
        const fees = await web3.deploy( 'Fees', [erc20.address]);
        const elections = await web3.deploy( "Elections", [minCommitteeSize, maxDelegationRatio, voteOutThreshold, voteOutTimeout, banningThreshold]);
        const staking = await Driver.newStakingContract(web3, elections.address, erc20.address);
        const subscriptions = await web3.deploy( 'Subscriptions', [erc20.address] );
        const protocol = await web3.deploy('Protocol', []);
        const compliance = await web3.deploy('Compliance', []);
        const committeeGeneral = await web3.deploy('Committee', [minCommitteeSize, maxCommitteeSize, generalCommitteeMinimumWeight, maxStandbys, readyToSyncTimeout]);
        const committeeCompliance = await web3.deploy('Committee', [minCommitteeSize, maxCommitteeSize, 0, maxStandbys, readyToSyncTimeout]);
        const validatorsRegistration = await web3.deploy('ValidatorsRegistration', []);

        await contractRegistry.set("staking", staking.address);
        await contractRegistry.set("bootstrapRewards", bootstrapRewards.address);
        await contractRegistry.set("stakingRewards", stakingRewards.address);
        await contractRegistry.set("fees", fees.address);
        await contractRegistry.set("elections", elections.address);
        await contractRegistry.set("subscriptions", subscriptions.address);
        await contractRegistry.set("protocol", protocol.address);
        await contractRegistry.set("compliance", compliance.address);
        await contractRegistry.set("validatorsRegistration", validatorsRegistration.address);
        await contractRegistry.set("committee-general", committeeGeneral.address);
        await contractRegistry.set("committee-compliance", committeeCompliance.address);

        await elections.setContractRegistry(contractRegistry.address);
        await bootstrapRewards.setContractRegistry(contractRegistry.address);
        await stakingRewards.setContractRegistry(contractRegistry.address);
        await fees.setContractRegistry(contractRegistry.address);
        await subscriptions.setContractRegistry(contractRegistry.address);
        await compliance.setContractRegistry(contractRegistry.address);
        await validatorsRegistration.setContractRegistry(contractRegistry.address);
        await committeeGeneral.setContractRegistry(contractRegistry.address);
        await committeeCompliance.setContractRegistry(contractRegistry.address);

        await protocol.setProtocolVersion(DEPLOYMENT_SUBSET_MAIN, 1, 0);

        return new Driver(web3,
            accounts,
            elections,
            erc20,
            externalToken,
            staking,
            subscriptions,
            bootstrapRewards,
            stakingRewards,
            fees,
            protocol,
            compliance,
            validatorsRegistration,
            committeeGeneral,
            committeeCompliance,
            contractRegistry
        );
    }

    static async newContractRegistry(web3: Web3Driver, governorAddr: string): Promise<ContractRegistryContract> {
        const accounts = await web3.eth.getAccounts();
        return await web3.deploy( 'ContractRegistry', [governorAddr],{from: accounts[0]}) as ContractRegistryContract;
    }

    static async newStakingContract(web3: Web3Driver, electionsAddr: string, erc20Addr: string): Promise<StakingContract> {
        const accounts = await web3.eth.getAccounts();
        const staking = await web3.deploy( "StakingContract", [1 /* _cooldownPeriodInSec */, accounts[0] /* _migrationManager */, "0x0000000000000000000000000000000000000001" /* _emergencyManager */, erc20Addr /* _token */]);
        await staking.setStakeChangeNotifier(electionsAddr, {from: accounts[0]});
        return staking;
    }

    get contractsOwner() {
        return this.accounts[0];
    }

    get contractsNonOwner() {
        return this.accounts[1];
    }

    get rewardsGovernor(): Participant {
        return new Participant("rewards-governor", "rewards-governor-website", "rewards-governor-contact", this.accounts[0], this.accounts[0], this);
    }

    async newSubscriber(tier: string, monthlyRate:number|BN): Promise<MonthlySubscriptionPlanContract> {
        const subscriber = await this.web3.deploy( 'MonthlySubscriptionPlan', [this.erc20.address, tier, monthlyRate]);
        await subscriber.setContractRegistry(this.contractRegistry.address);
        await this.subscriptions.addSubscriber(subscriber.address);
        return subscriber;
    }

    newParticipant(): Participant { // consumes two addresses from accounts for each participant - ethereum address and an orbs address
        const RESERVED_ACCOUNTS = 2;
        const v = new Participant(
            `Validator${this.participants.length}-name`,
            `Validator${this.participants.length}-website`,
            `Validator${this.participants.length}-contact`,
            this.accounts[RESERVED_ACCOUNTS + this.participants.length*2],
            this.accounts[RESERVED_ACCOUNTS + this.participants.length*2+1],
            this);
        this.participants.push(v);
        return v;
    }

    async delegateMoreStake(amount:number|BN, delegatee: Participant) {
        const delegator = this.newParticipant();
        await delegator.stake(new BN(amount));
        return await delegator.delegate(delegatee);
    }

}

export class Participant { // TODO Consider implementing validator methods in a child class.
    public ip: string;
    private erc20: ERC20Contract;
    private externalToken: ERC20Contract;
    private staking: StakingContract;
    private elections: ElectionsContract;
    private validatorsRegistration: ValidatorsRegistrationContract;
    private compliance: ComplianceContract;

    constructor(public name: string,
                public website: string,
                public contact: string,
                public address: string,
                public orbsAddress: string,
                driver: Driver) {
        this.name = name;
        this.ip = address.substring(0, 10).toLowerCase(); // random IP using the 4 first bytes from address string TODO simplify
        this.erc20 = driver.erc20;
        this.externalToken = driver.externalToken;
        this.staking = driver.staking;
        this.elections = driver.elections;
        this.validatorsRegistration = driver.validatorsRegistration;
        this.compliance = driver.compliance;
    }

    async stake(amount: number|BN, staking?: StakingContract) {
        staking = staking || this.staking;
        await this.assignAndApproveOrbs(amount, staking.address);
        return staking.stake(amount, {from: this.address});
    }

    private async assignAndApprove(amount: number|BN, to: string, token: ERC20Contract) {
        await token.assign(this.address, amount);
        await token.approve(to, amount, {from: this.address});
    }

    async assignAndApproveOrbs(amount: number|BN, to: string) {
        return this.assignAndApprove(amount, to, this.erc20);
    }

    async assignAndApproveExternalToken(amount: number|BN, to: string) {
        return this.assignAndApprove(amount, to, this.externalToken);
    }

    async unstake(amount: number|BN) {
        return this.staking.unstake(amount, {from: this.address});
    }

    async delegate(to: Participant) {
        return this.elections.delegate(to.address, {from: this.address});
    }

    async registerAsValidator() {
        return await this.validatorsRegistration.registerValidator(this.ip, this.orbsAddress, this.name, this.website, this.contact, {from: this.address});
    }

    async notifyReadyForCommittee() {
        return await this.elections.notifyReadyForCommittee({from: this.orbsAddress});
    }

    async notifyReadyToSync() {
        return await this.elections.notifyReadyToSync({from: this.orbsAddress});
    }

    async becomeComplianceType() {
        return await this.compliance.setValidatorCompliance(this.address, CONFORMANCE_TYPE_COMPLIANCE);
    }

    async becomeGeneralType() {
        return await this.compliance.setValidatorCompliance(this.address, CONFORMANCE_TYPE_GENERAL);
    }
}

export async function expectRejected(promise: Promise<any>, msg?: string) {
    try {
        await promise;
    } catch (err) {
        // TODO verify correct error
        return
    }
    throw new Error(msg || "expected promise to reject")
}

