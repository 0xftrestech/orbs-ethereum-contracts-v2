pragma solidity 0.5.16;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/math/Math.sol";

import "./spec_interfaces/ICommitteeListener.sol";
import "./interfaces/IElections.sol";
import "./spec_interfaces/IValidatorsRegistration.sol";
import "./IStakingContract.sol";
import "./spec_interfaces/ICommittee.sol";
import "./spec_interfaces/ICompliance.sol";
import "./ContractRegistryAccessor.sol";
import "./spec_interfaces/IDelegation.sol";

contract Delegations is IDelegations, IStakeChangeNotifier, ContractRegistryAccessor {
	using SafeMath for uint256;

	// TODO remove
	event debug_notifyStakeChange(address stakeOwner, uint256 newUncappedStake, uint256 prevGovStakeOwner, address delegatee, uint256 prevGovStakeDelegatee, uint256 newGovStakeDelegator, uint256 newGovStakeDelegetee, uint256 newTotalGovStake);
	event debug_notifyDelegationChange(address newDelegatee, address prevDelegatee, uint256 newStakePrevDelegatee, uint256 newStakeNewDelegatee, uint256 prevGovStakePrevDelegatee, uint256 prevGovStakeNewDelegatee, uint256 newGovStake, uint256 newTotalGovStake);

	// TODO consider using structs instead of multiple mappings
	mapping (address => uint256) ownStakes;
	mapping (address => uint256) uncappedStakes;
	uint256 totalGovernanceStake; // TODO - move to elections

	mapping (address => address) delegations;

	modifier onlyStakingContract() {
		require(msg.sender == address(getStakingContract()), "caller is not the staking contract");

		_;
	}

	constructor() public {
	}
	function delegate(address to) external {
		address prevDelegatee = getDelegation(msg.sender);

		uint256 prevGovStakePrevDelegatee = getGovernanceEffectiveStake(prevDelegatee);
		uint256 prevGovStakeNewDelegatee = getGovernanceEffectiveStake(to);

		delegations[msg.sender] = to; // delegation!

		uint256 delegatorStake = ownStakes[msg.sender];

		uint256 newStakePrevDelegatee = uncappedStakes[prevDelegatee].sub(delegatorStake);
		uncappedStakes[prevDelegatee] = newStakePrevDelegatee;
		totalGovernanceStake = totalGovernanceStake.sub(prevGovStakePrevDelegatee).add(getGovernanceEffectiveStake(prevDelegatee));

		uint256 newStakeNewDelegatee = uncappedStakes[to].add(delegatorStake);
		uncappedStakes[to] = newStakeNewDelegatee;
		totalGovernanceStake = totalGovernanceStake.sub(prevGovStakeNewDelegatee).add(getGovernanceEffectiveStake(to));

		emit debug_notifyDelegationChange(to, prevDelegatee, newStakePrevDelegatee, newStakeNewDelegatee, prevGovStakePrevDelegatee, prevGovStakeNewDelegatee, getGovernanceEffectiveStake(to), getTotalGovernanceStake());
    	getElectionsContract().notifyDelegationChange(to, prevDelegatee, newStakePrevDelegatee, newStakeNewDelegatee, prevGovStakePrevDelegatee, prevGovStakeNewDelegatee);

		emit Delegated(msg.sender, to);
	}

	function stakeChange(address _stakeOwner, uint256 _amount, bool _sign, uint256 _updatedStake) external onlyStakingContract {
		_stakeChange(_stakeOwner, _amount, _sign, _updatedStake);
		//TODO? emit DelegatedStakeChanged(address addr, uint256 selfSstake, uint256 delegatedStake);
	}

	function stakeChangeBatch(address[] calldata _stakeOwners, uint256[] calldata _amounts, bool[] calldata _signs, uint256[] calldata _updatedStakes) external onlyStakingContract {
		require(_stakeOwners.length == _amounts.length, "_stakeOwners, _amounts - array length mismatch");
		require(_stakeOwners.length == _signs.length, "_stakeOwners, _signs - array length mismatch");
		require(_stakeOwners.length == _updatedStakes.length, "_stakeOwners, _updatedStakes - array length mismatch");

		for (uint i = 0; i < _stakeOwners.length; i++) {
			_stakeChange(_stakeOwners[i], _amounts[i], _signs[i], _updatedStakes[i]);
		}
	}

	function getDelegation(address addr) public view returns (address) {
		address d = delegations[addr];
		return (d == address(0)) ? addr : d;
	}

	function stakeMigration(address _stakeOwner, uint256 _amount) external onlyStakingContract {}

	function refreshStakes(address[] calldata addrs) external {
		IStakingContract staking = getStakingContract();

		for (uint i = 0; i < addrs.length; i++) {
			address staker = addrs[i];
			uint256 newOwnStake = staking.getStakeBalanceOf(staker);
			uint256 oldOwnStake = ownStakes[staker];
			if (newOwnStake > oldOwnStake) {
				_stakeChange(staker, newOwnStake - oldOwnStake, true, newOwnStake);
			} else if (oldOwnStake > newOwnStake) {
				_stakeChange(staker, oldOwnStake - newOwnStake, false, newOwnStake);
			}
		}
	}
	function _stakeChange(address _stakeOwner, uint256 _amount, bool _sign, uint256 /* _updatedStake */) private {
		address delegatee = getDelegation(_stakeOwner);

		uint256 prevGovStakeOwner = getGovernanceEffectiveStake(_stakeOwner);
		uint256 prevGovStakeDelegatee = getGovernanceEffectiveStake(delegatee);

		uint256 newUncappedStake;
		uint256 newOwnStake;
		if (_sign) {
			newOwnStake = ownStakes[_stakeOwner].add(_amount);
			newUncappedStake = uncappedStakes[delegatee].add(_amount);
		} else {
			newOwnStake = ownStakes[_stakeOwner].sub(_amount);
			newUncappedStake = uncappedStakes[delegatee].sub(_amount);
		}
		ownStakes[_stakeOwner] = newOwnStake;

		uncappedStakes[delegatee] = newUncappedStake;

		totalGovernanceStake = totalGovernanceStake.sub(prevGovStakeDelegatee).add(getGovernanceEffectiveStake(delegatee));

		emit debug_notifyStakeChange(_stakeOwner, newUncappedStake, prevGovStakeOwner, delegatee, prevGovStakeDelegatee, getGovernanceEffectiveStake(_stakeOwner), getGovernanceEffectiveStake(delegatee), getTotalGovernanceStake());
		getElectionsContract().notifyStakeChange(_stakeOwner, newUncappedStake, prevGovStakeOwner, delegatee, prevGovStakeDelegatee);
	}

	function getOwnStake(address addr) external view returns (uint256) {
		return ownStakes[addr];
	}

	function getDelegatedStakes(address addr) external view returns (uint256) {
		return uncappedStakes[addr];
	}

	function getTotalGovernanceStake() public view returns (uint256) {
		return totalGovernanceStake;
	}

    function getGovernanceEffectiveStake(address v) public view returns (uint256) {
		return _isSelfDelegating(v) ? uncappedStakes[v] : 0;
	}

	function _isSelfDelegating(address validator) private view returns (bool) {
		return delegations[validator] == address(0) || delegations[validator] == validator;
	}
}
