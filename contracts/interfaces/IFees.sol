pragma solidity 0.5.16;

import "../IStakingContract.sol";
import "./IContractRegistry.sol";

/// @title Fees contract interface
interface IFees {
    event FeesAssigned(address[] assignees, uint256[] orbs_amounts, uint256[] bootstrap_amounts);
    event FeesAddedToBucket(uint256 bucketId, uint256 added, uint256 total);
    event BootstrapAddedToPool(uint256 added, uint256 total);

    /*
     *   External methods
     */

    /// @dev Calculates and assigns validator fees and bootstrap fund for the time period since the last reward calculation
    function assignFees() external;

    /// @return Returns the currently unclaimed orbs token reward balance of the given address.
    function getOrbsBalance(address addr) external view returns (uint256 balance);

    /// @return Returns the currently unclaimed bootstrap balance of the given address.
    function getBootstrapBalance(address addr) external view returns (uint256 balance);

    /// @dev Transfer all of msg.sender's outstanding balance to their account
    function withdrawFunds() external;

    /// @return The timestamp of the last reward assignment.
    function getLastFeesAssignment() external view returns (uint256 time);

    /// @dev Transfers the given amount of bootstrap tokens form the sender to this contract and update the pool.
    /// Assumes the tokens were approved for transfer
    function topUpBootstrapPool(uint256 amount) external;

    /// @dev Called by: subscriptions contract
    /// Top-ups the fee pool with the given amount at the given rate (typically called by the subscriptions contract)
    function fillFeeBuckets(uint256 amount, uint256 monthlyRate) external;

    /*
     * Reward-governor methods
     */

    /// @dev Assigns rewards and sets a new monthly rate for the geenral commitee bootstrap.
    function setGeneralCommitteeeBootstrapMonthlyRate(uint256 rate);

    /// @dev Assigns rewards and sets a new monthly rate for the compliance commitee bootstrap.
    function setComplianceCommitteeeBootstrapMonthlyRate(uint256 rate);

    /*
     * General governance
     */

    /// @dev Updates the address of the contract registry
    function setContractRegistry(IContractRegistry _contractRegistry) external /* onlyOwner */;


}
