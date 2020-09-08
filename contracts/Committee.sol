// SPDX-License-Identifier: UNLICENSED

pragma solidity 0.6.12;

import "./spec_interfaces/ICommittee.sol";
import "./spec_interfaces/IGuardiansRegistration.sol";
import "@openzeppelin/contracts/math/Math.sol";
import "./ContractRegistryAccessor.sol";
import "./Lockable.sol";
import "./interfaces/IRewards.sol";
import "./interfaces/IElections.sol";
import "./ManagedContract.sol";

contract Committee is ICommittee, ManagedContract {
	struct CommitteeMember {
		address addr;
		uint96 weightAndCertifiedBit;
	}
	CommitteeMember[] public committee;

	struct MemberStatus {
		uint32 pos;
		bool inCommittee;
	}
	mapping (address => MemberStatus) membersStatus;

	struct Settings {
		uint32 maxTimeBetweenRewardAssignments;
		uint8 maxCommitteeSize;
	}
	Settings public settings;

	struct CommitteeStats {
		uint96 totalWeight;
		uint32 generalCommitteeSize;
		uint32 certifiedCommitteeSize;
	}
	CommitteeStats committeeStats;

	modifier onlyElectionsContract() {
		require(msg.sender == address(electionsContract), "caller is not the elections");

		_;
	}

	uint96 constant CERTIFICATION_MASK = 1 << 95;
	uint96 constant WEIGHT_MASK = ~CERTIFICATION_MASK;

	constructor(IContractRegistry _contractRegistry, address _registryAdmin, uint8 _maxCommitteeSize, uint32 maxTimeBetweenRewardAssignments) ManagedContract(_contractRegistry, _registryAdmin) public {
		setMaxCommitteeSize(_maxCommitteeSize);
		setMaxTimeBetweenRewardAssignments(maxTimeBetweenRewardAssignments);
	}

	/*
	 * Methods restricted to other Orbs contracts
	 */

	function memberChange(address addr, uint256 weight, bool isCertified) external override onlyElectionsContract onlyWhenActive returns (bool committeeChanged) {
		MemberStatus memory status = membersStatus[addr];

		if (!status.inCommittee) {
			return false;
		}
		CommitteeStats memory _committeeStats = committeeStats;

		CommitteeMember memory member = committee[status.pos];
		(uint prevWeight, uint prevCertification) = getWeightCertification(member);

		if (weight != prevWeight) {
			rewardsContract.committeeMemberStakeWillChange(addr, prevWeight);
		}

		if (isCertified != prevCertification) {
			rewardsContract.committeeMembershipWillChange(addr, prevWeight, _committeeStats.totalWeight, true, prevCertification, _committeeStats.generalCommitteeSize, _committeeStats.certifiedCommitteeSize);
		}

		_committeeStats.totalWeight = _committeeStats.totalWeight.sub(prevWeight).add(weight);
		_committeeStats.certifiedCommitteeSize = _committeeStats.certifiedCommitteeSize - (prevCertification ? 1 : 0) + (isCertified ? 1 : 0);
		committeeStats = _committeeStats;

		committee[status.pos].weightAndCertifiedBit = packWeightCertification(weight, isCertified);
		emit GuardianCommitteeChange(addr, weight, isCertified, true);

		return true;
	}

	function addMember(address addr, uint256 weight, bool isCertified) external override onlyElectionsContract onlyWhenActive returns (bool committeeChanged) {
		Settings memory _settings = settings;
		MemberStatus memory status = membersStatus[addr];

		if (status.inCommittee) {
			return false;
		}

		(bool qualified, uint entryPos) = qualifiesToEnterCommittee(addr, weight, _settings);
		if (!qualified) {
			return false;
		}

		CommitteeStats memory _committeeStats = committeeStats;
		rewardsContract.committeeMembershipWillChange(addr, 0, _committeeStats.totalWeight, false, false, _committeeStats.generalCommitteeSize, _committeeStats.certifiedCommitteeSize);

		_committeeStats.generalCommitteeSize++;
		if (isCertified) _committeeStats.certifiedCommitteeSize++;
		_committeeStats.totalWeight = _committeeStats.totalWeight.add(weight);

		CommitteeMember memory newMember = CommitteeMember({
			addr: addr,
			weightAndCertifiedBit: packWeightCertification(weight, isCertified)
		});

		if (entryPos < committee.length) {
			_committeeStats = removeMemberAtPos(entryPos, false, _committeeStats); // TODO this will notify the rewards contract with committeeSize == maxCommittee + 1, make sure it's ok
			committee[entryPos] = newMember;
		} else {
			committee.push(newMember);
		}

		status.inCommittee = true;
		status.pos = uint32(entryPos);
		membersStatus[addr] = status;

		committeeStats = _committeeStats;

		emit GuardianCommitteeChange(addr, weight, isCertified, true);
		return true;
	}

	/// @dev Called by: Elections contract
	/// Notifies a a member removal for example due to voteOut / voteUnready
	function removeMember(address addr) external override onlyElectionsContract onlyWhenActive returns (bool committeeChanged) {
		MemberStatus memory status = membersStatus[addr];
		if (!status.inCommittee) {
			return false;
		}

		committeeStats = removeMemberAtPos(status.pos, true, committeeStats);
		return true;
	}

	/// @dev Called by: Elections contract
	/// Returns the committee members and their weights
	function getCommittee() external override view returns (address[] memory addrs, uint256[] memory weights, bool[] memory certification) {
		return _getCommittee();
	}

	function _getCommittee() private view returns (address[] memory addrs, uint256[] memory weights, bool[] memory certification) {
		CommitteeMember[] memory _committee = committee;
		addrs = new address[](_committee.length);
		weights = new uint[](_committee.length);
		certification = new bool[](_committee.length);

		for (uint i = 0; i < _committee.length; i++) {
			addrs[i] = _committee[i].addr;
			(weights[i], certification[i]) = getWeightCertification(_committee[i]);
		}
	}

	/*
	 * Governance
	 */

	function setMaxTimeBetweenRewardAssignments(uint32 maxTimeBetweenRewardAssignments) public override onlyFunctionalManager /* todo onlyWhenActive */ {
		emit MaxTimeBetweenRewardAssignmentsChanged(maxTimeBetweenRewardAssignments, settings.maxTimeBetweenRewardAssignments);
		settings.maxTimeBetweenRewardAssignments = maxTimeBetweenRewardAssignments;
	}

	function getMaxTimeBetweenRewardAssignments() external override view returns (uint32) {
		return settings.maxTimeBetweenRewardAssignments;
	}

	function getMinCommitteeMember() external view returns (address addr, uint256 weight) {
		(addr, weight, ) = _getMinCommitteeMember();
	}

	function setMaxCommitteeSize(uint8 maxCommitteeSize) public override onlyFunctionalManager /* todo onlyWhenActive */ {
		require(maxCommitteeSize > 0, "maxCommitteeSize must be larger than 0");
		Settings memory _settings = settings;
		uint8 prevMaxCommitteeSize = _settings.maxCommitteeSize;
		_settings.maxCommitteeSize = maxCommitteeSize;
		settings = _settings;

		CommitteeStats memory _committeeStats = committeeStats;
		while (committee.length > maxCommitteeSize) {
			(, ,uint pos) = _getMinCommitteeMember();
			_committeeStats = removeMemberAtPos(pos, true, _committeeStats);
		}
		committeeStats = _committeeStats;

		emit MaxCommitteeSizeChanged(maxCommitteeSize, prevMaxCommitteeSize);
	}

	function getMaxCommitteeSize() external override view returns (uint8) {
		return settings.maxCommitteeSize;
	}

	/*
     * Getters
     */

	/// @dev returns the current committee
	/// used also by the rewards and fees contracts
	function getCommitteeInfo() external override view returns (address[] memory addrs, uint256[] memory weights, address[] memory orbsAddrs, bool[] memory certification, bytes4[] memory ips) {
		(addrs, weights, certification) = _getCommittee();
		return (addrs, weights, _loadOrbsAddresses(addrs), certification, _loadIps(addrs));
	}

	function getSettings() external override view returns (uint32 maxTimeBetweenRewardAssignments, uint8 maxCommitteeSize) {
		Settings memory _settings = settings;
		maxTimeBetweenRewardAssignments = _settings.maxTimeBetweenRewardAssignments;
		maxCommitteeSize = _settings.maxCommitteeSize;
	}

	function getCommitteeStats() external view returns (uint generalCommitteeSize, uint certifiedCommitteeSize, uint totalWeight) {
		CommitteeStats _committeeStats = committeeStats;
		return (_committeeStats.generalCommitteeSize, _committeeStats.certifiedCommitteeSize, _committeeStats.totalWeight);
	}

	function getMemberInfo(address addr) external view returns (bool inCommittee, uint stake, bool isCertified) {
		MemberStatus memory status = membersStatus[addr];
		inCommittee = status.inCommittee;
		if (inCommittee) {
			(stake, isCertified) = getWeightCertification(committee[status.pos]);
		}
	}

	/*
	 * Private
	 */

	function packWeightCertification(uint256 weight, bool certification) private pure returns (uint96 weightAndCertified) {
		return uint96(weight) | (certification ? CERTIFICATION_MASK : 0);
	}

	function unpackWeightCertification(uint96 weightAndCertified) private pure returns (uint256 weight, bool certification) {
		return (uint256(weightAndCertifiedBit & WEIGHT_MASK), weightAndCertifiedBit & CERTIFICATION_MASK != 0);
	}

	function getWeightCertification(CommitteeMember memory member) private pure returns (uint256 weight, bool certification) {
		return unpackWeightCertification(member.weightAndCertifiedBit);
	}

	function _getMinCommitteeMember() private view returns (
		address minMemberAddress,
		uint256 minMemberWeight,
		uint minMemberPos
	){
		CommitteeMember[] memory _committee = committee;
		minMemberPos = uint256(-1);
		minMemberWeight = uint256(-1);
		uint256 memberWeight;
		address memberAddress;
		for (uint i = 0; i < _committee.length; i++) {
			memberAddress = _committee[i].addr;
			(memberWeight,) = getWeightCertification(_committee[i]);
			if (memberWeight < minMemberWeight || memberWeight == minMemberWeight && memberAddress < minMemberAddress) {
				minMemberPos = i;
				minMemberWeight = memberWeight;
				minMemberAddress = memberAddress;
			}
		}
	}

	function qualifiesToEnterCommittee(address addr, uint256 weight, Settings memory _settings) private view returns (bool qualified, uint entryPos) {
		uint committeeLength = committee.length;
		if (committeeLength < _settings.maxCommitteeSize) {
			return (true, committeeLength);
		}

		(address minMemberAddress, uint256 minMemberWeight, uint minMemberPos) = _getMinCommitteeMember();

		if (weight > minMemberWeight || weight == minMemberWeight && addr > minMemberAddress) {
			return (true, minMemberPos);
		}

		return (false, 0);
	}

	function removeMemberAtPos(uint pos, bool clearFromList, CommitteeStats _committeeStats) private returns (CommitteeStats memory newCommitteeStats){
		CommitteeMember memory member = committee[pos];

		(uint weight, uint certification) = getWeightCertification(member);

		rewardsContract.committeeMembershipWillChange(member.addr, weight, _committeeStats.totalWeight, true, certification, _committeeStats.generalCommitteeSize, _committeeStats.certifiedCommitteeSize);

		delete membersStatus[member.addr];

		_committeeStats.generalCommitteeSize--;
		if (certification) _committeeStats.certifiedCommitteeSize--;
		_committeeStats.totalWeight = _committeeStats.totalWeight.sub(weight);

		emit GuardianCommitteeChange(member.addr, weight, certification, false);

		if (clearFromList) {
			uint committeeLength = committee.length;
			if (pos < committeeLength - 1) {
				CommitteeMember memory last = committee[committeeLength - 1];
				committee[pos] = last;
				membersStatus[last.addr].pos = uint32(pos);
			}
			committee.pop();
		}

		return _committeeStats;
	}

	function _loadOrbsAddresses(address[] memory addrs) private view returns (address[] memory) {
		return guardianRegistrationContract.getGuardiansOrbsAddress(addrs);
	}

	function _loadIps(address[] memory addrs) private view returns (bytes4[] memory) {
		return guardianRegistrationContract.getGuardianIps(addrs);
	}

	IElections electionsContract;
	IRewards rewardsContract;
	IGuardiansRegistration guardianRegistrationContract;
	function refreshContracts() external override {
		electionsContract = IElections(getElectionsContract());
		rewardsContract = IRewards(getRewardsContract());
		guardianRegistrationContract = IGuardiansRegistration(getGuardiansRegistrationContract());
	}

}
