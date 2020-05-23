pragma solidity 0.5.16;

import "../IStakingContract.sol";
import "../spec_interfaces/IContractRegistry.sol";

/// @title Rewards contract interface
interface IRewards {

    function assignRewards(address[] calldata generalCommittee, uint256[] calldata generalCommitteeWeights, address[] calldata complianceCommittee) external /* onlyElectionsContract */;

    // staking

    event StakingRewardsDistributed(address indexed distributer, uint256 fromBlock, uint256 toBlock, uint split, uint txIndex, address[] to, uint256[] amounts);
    event StakingRewardAssigned(address assignee, uint256 amount, uint256 balance);

    /// @return Returns the currently unclaimed orbs token reward balance of the given address.
    function getStakingRewardBalance(address addr) external view returns (uint256 balance);

    /// @dev Distributes msg.sender's orbs token rewards to a list of addresses, by transferring directly into the staking contract.
    function distributeOrbsTokenStakingRewards(uint256 totalAmount, uint256 fromBlock, uint256 toBlock, uint split, uint txIndex, address[] calldata to, uint256[] calldata amounts) external;

    /// @dev Transfers the given amount of orbs tokens form the sender to this contract an update the pool.
    function topUpStakingRewardsPool(uint256 amount) external;

    /*
    *   Reward-governor methods
    */

    /// @dev Assigns rewards and sets a new monthly rate for the pro-rata pool.
    function setAnnualStakingRewardsRate(uint256 annual_rate_in_percent_mille, uint256 annual_cap) external /* onlyRewardsGovernor */;


    // fees

    event FeesAssigned(address[] assignees, uint256[] orbs_amounts);
    event FeesAddedToBucket(uint256 bucketId, uint256 added, uint256 total, bool isCompliant);

    /*
     *   External methods
     */

    /// @return Returns the currently unclaimed orbs token reward balance of the given address.
    function getFeeBalance(address addr) external view returns (uint256 balance);

    /// @dev Transfer all of msg.sender's outstanding balance to their account
    function withdrawFeeFunds() external;

    /// @return The timestamp of the last reward assignment.
    function getLastFeesAssignment() external view returns (uint256 time);

    /// @dev Called by: subscriptions contract
    /// Top-ups the compliance fee pool with the given amount at the given rate (typically called by the subscriptions contract)
    function fillComplianceFeeBuckets(uint256 amount, uint256 monthlyRate, uint256 fromTimestamp) external;

    /// @dev Called by: subscriptions contract
    /// Top-ups the general fee pool with the given amount at the given rate (typically called by the subscriptions contract)
    function fillGeneralFeeBuckets(uint256 amount, uint256 monthlyRate, uint256 fromTimestamp) external;

    // bootstrap

    event BootstrapRewardsAssigned(address[] assignees, uint256[] amounts);
    event BootstrapAddedToPool(uint256 added, uint256 total);

    /*
     *   External methods
     */

    /// @return Returns the currently unclaimed bootstrap balance of the given address.
    function getBootstrapBalance(address addr) external view returns (uint256 balance);

    /// @dev Transfer all of msg.sender's outstanding balance to their account
    function withdrawBootstrapFunds() external;

    /// @return The timestamp of the last reward assignment.
    function getLastBootstrapAssignment() external view returns (uint256 time);

    /// @dev Transfers the given amount of bootstrap tokens form the sender to this contract and update the pool.
    /// Assumes the tokens were approved for transfer
    function topUpBootstrapPool(uint256 amount) external;

    /*
     * Reward-governor methods
     */

    /// @dev Assigns rewards and sets a new monthly rate for the geenral commitee bootstrap.
    function setGeneralCommitteeAnnualBootstrap(uint256 annual_amount) external;

    /// @dev Assigns rewards and sets a new monthly rate for the compliance commitee bootstrap.
    function setComplianceCommitteeAnnualBootstrap(uint256 annual_amount) external;


    /*
     * General governance
     */

    /// @dev Updates the address of the contract registry
    function setContractRegistry(IContractRegistry _contractRegistry) external /* onlyOwner */;


}
