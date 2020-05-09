pragma solidity 0.5.16;

import "../spec_interfaces/IContractRegistry.sol";
import "../IStakeChangeNotifier.sol";

/// @title Elections contract interface
interface IElections /* is IStakeChangeNotifier */ {
	event StakeChanged(address addr, uint256 ownStake, uint256 uncappedStake, uint256 governanceStake, uint256 committeeStake, uint256 totalGovernanceStake);
	event CommitteeChanged(address[] addrs, address[] orbsAddrs, uint256[] stakes);
	event TopologyChanged(address[] orbsAddrs, bytes4[] ips);
	event VoteOut(address voter, address against);
	event VotedOutOfCommittee(address addr);
	event BanningVote(address voter, address[] against);
	event Banned(address validator);
	event Unbanned(address validator);

	/*
	 *   External methods
	 */

	/// @dev Called by a validator when ready to start syncing with other nodes
	function notifyReadyToSync() external;

	/// @dev Called by a validator when ready to join the committee, typically after syncing is complete or after being voted out
	function notifyReadyForCommittee() external;

	/// @dev Called by a validator as part of the automatic vote-out flow
	function voteOut(address addr) external;

	/// @dev casts a banning vote by the sender to the given address
	function setBanningVotes(address[] calldata addrs) external;

	/*
	 *   Methods restricted to other Orbs contracts
	 */

	/// @dev Called by: validator registration contract
	/// Notifies a new validator was registered
	function validatorRegistered(address addr) external /* onlyValidatorsRegistrationContract */;

	/// @dev Called by: validator registration contract
	/// Notifies a new validator was unregistered
	function validatorUnregistered(address addr) external /* onlyValidatorsRegistrationContract */;

	/// @dev Called by: validator registration contract
	/// Notifies on a validator compliance change
	function validatorComplianceChanged(address addr, bool isCompliant) external /* onlyComplianceContract */;

	function notifyStakeChange(address stakeOwner, uint256 newUncappedStake, uint256 prevGovStakeOwner, address delegatee, uint256 prevGovStakeDelegatee) external /*onlyDelegationsContract*/;
	function notifyDelegationChange(address newDelegatee, address prevDelegatee, uint256 newStakePrevDelegatee, uint256 newStakeNewDelegatee, uint256 prevGovStakePrevDelegatee, uint256 prevGovStakeNewDelegatee) external /*onlyDelegationsContract*/;
}

