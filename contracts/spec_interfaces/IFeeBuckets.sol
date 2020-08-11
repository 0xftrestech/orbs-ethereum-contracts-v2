pragma solidity 0.5.16;

import "../spec_interfaces/IContractRegistry.sol";
import "../spec_interfaces/IMigratableFeesWallet.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";


/// @title Fees Wallet contract interface, manages the fee buckets
interface IFeesWallet {

    event FeesWithdrawnFromBucket(uint256 bucketId, uint256 withdrawn, uint256 total);
    event FeesAddedToBucket(uint256 bucketId, uint256 added, uint256 total);

    /// @dev collect fees from the buckets since the last call and transfers the amount back.
    /// Called by: only Rewards contract.
    function collectFees() external returns (uint256 collectedFees) /* onlyRewardsContract */;

    /*
     *   External methods
     */

    /// @dev Called by: subscriptions contract.
    /// Top-ups the fee pool with the given amount at the given rate (typically called by the subscriptions contract).
    function fillFeeBuckets(uint256 amount, uint256 monthlyRate, uint256 fromTimestamp) external;

    /// @dev Called by the old FeesWallet contract.
    /// Part of the IMigratableFeesWallet interface.
    function acceptBucketMigration(uint256 bucketStartTime, uint256 amount) external;

    /*
     * General governance
     */

    /// @dev Updates the address of the contract registry.
    function setContractRegistry(IContractRegistry _contractRegistry) external /* onlyMigrationOwner */;

    /// @dev migrates the fees of bucket starting at startTimestamp.
    /// bucketStartTime must be a bucket's start time.
    /// Calls acceptBucketMigration in the destination contract.
    function migrateBucket(IMigratableFeesWallet destination, uint256 bucketStartTime) external /* onlyMigrationOwner */;

    /*
     * Emergency
     */

    /// @dev an emergency withdrawal enables withdrawal of all funds to an escrow account. To be use in emergencies only.
    function emergencyWithdraw() external /* OnlyMigrationOwner */;

//   constructor(IERC20 token);    

}