import {Contract} from "../eth";
import {TransactionConfig, TransactionReceipt} from "web3-core";
import * as BN from "bn.js";
import {OwnedContract} from "./base-contract";

export interface ElectionsContract extends OwnedContract {
  registerValidator( ip: string, orbsAddrs: string, params?: TransactionConfig): Promise<TransactionReceipt>;
  getTopology(): Promise<TransactionReceipt>;
  notifyReadyForCommittee(params?: TransactionConfig): Promise<TransactionReceipt>;
  notifyReadyToSync(params?: TransactionConfig): Promise<TransactionReceipt>;
  voteOut(address: string, params?: TransactionConfig): Promise<TransactionReceipt>;
  setValidatorOrbsAddress(orbsAddress: string, params?: TransactionConfig): Promise<TransactionReceipt>;
  setValidatorIp(ip: string, params?: TransactionConfig): Promise<TransactionReceipt>;
  setContractRegistry(contractRegistry: string, params?: TransactionConfig): Promise<TransactionReceipt>;
  setBanningVotes(address: string[], params?: TransactionConfig): Promise<TransactionReceipt>;
  refreshBanningVote(voter: string, against: string, params?: TransactionConfig): Promise<TransactionReceipt>;
  getBanningVotes(address: string): Promise<string[]>;
  getAccumulatedStakesForBanning(address: string): Promise<BN>;
  getTotalGovernanceStake(): Promise<BN>;

  setVoteOutTimeoutSeconds(voteOutTimeoutSeconds: number|BN, params?: TransactionConfig): Promise<TransactionReceipt>;
  setMaxDelegationRatio(maxDelegationRatio: number|BN, params?: TransactionConfig): Promise<TransactionReceipt>;
  setBanningLockTimeoutSeconds(banningLockTimeoutSeconds: number|BN, params?: TransactionConfig): Promise<TransactionReceipt>;
  setVoteOutPercentageThreshold(voteOutPercentageThreshold: number|BN, params?: TransactionConfig): Promise<TransactionReceipt>;
  setBanningPercentageThreshold(banningPercentageThreshold: number|BN, params?: TransactionConfig): Promise<TransactionReceipt>;

  getSettings(params?: TransactionConfig): Promise<[
    number|BN /* voteOutTimeoutSeconds */,
    number|BN /* maxDelegationRatio */,
    number|BN /* banningLockTimeoutSeconds */,
    number|BN /* voteOutPercentageThreshold */,
    number|BN /* banningPercentageThreshold */
  ]>;

}

export interface TopologyChangedEvent {
  orbsAddrs: string[];
  ips: string[];
}

export interface ValidatorRegisteredEvent_deprecated {
  addr: string;
  ip: string;
}

export interface StakeChangeEvent {
  addr: string;
  ownStake: number | BN;
  uncappedStake: number | BN;
  governanceStake: number | BN;
  committeeStake: number | BN;
}

export interface VoteOutEvent {
  voter: string;
  against: string;
}

export interface VotedOutOfCommitteeEvent {
  addr: string;
}

export interface BanningVoteEvent {
  voter: string;
  against: string[];
}

export interface BannedEvent {
  validator: string;
}

export interface UnbannedEvent {
  validator: string;
}

export interface  VoteOutTimeoutSecondsChangedEvent {
  newValue: string|BN,
  oldValue: string|BN,
}

export interface  MaxDelegationRatioChangedEvent {
  newValue: string|BN,
  oldValue: string|BN,
}

export interface  BanningLockTimeoutSecondsChangedEvent {
  newValue: string|BN,
  oldValue: string|BN,
}

export interface  VoteOutPercentageThresholdChangedEvent {
  newValue: string|BN,
  oldValue: string|BN,
}

export interface  BanningPercentageThresholdChangedEvent {
  newValue: string|BN,
  oldValue: string|BN,
}

