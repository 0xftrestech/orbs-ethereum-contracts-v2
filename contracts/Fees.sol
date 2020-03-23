pragma solidity 0.5.16;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/ownership/Ownable.sol";
import "@openzeppelin/contracts/math/Math.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "./IStakingContract.sol";
import "./interfaces/IElections.sol";
import "./spec_interfaces/IFees.sol";

contract Fees is IFees, Ownable {
    using SafeMath for uint256;

    enum CommitteeType {
        General,
        Compliance
    }

    IContractRegistry contractRegistry;

    uint256 constant bucketTimePeriod = 30 days;

    mapping(uint256 => uint256) generalFeePoolBuckets;
    mapping(uint256 => uint256) complianceFeePoolBuckets;

    uint256 lastPayedAt;

    mapping(address => uint256) orbsBalance;

    IERC20 erc20;

    constructor(IERC20 _erc20) public {
        require(address(_erc20) != address(0), "erc20 must not be 0");

        erc20 = _erc20;
        lastPayedAt = now;
    }

    function setContractRegistry(IContractRegistry _contractRegistry) external onlyOwner {
        require(address(_contractRegistry) != address(0), "contractRegistry must not be 0");
        contractRegistry = _contractRegistry;
    }

    function getOrbsBalance(address addr) external view returns (uint256) {
        return orbsBalance[addr];
    }

    function getLastFeesAssignment() external view returns (uint256) {
        return lastPayedAt;
    }

    uint constant MAX_REWARD_BUCKET_ITERATIONS = 6;

    function assignFees() external {
        _assignFees();
    }

    function _assignFees() private {
        // TODO we often do integer division for rate related calculation, which floors the result. Do we need to address this?
        // TODO for an empty committee or a committee with 0 total stake the divided amounts will be locked in the contract FOREVER

        // Fee pool
        uint bucketsPayed = 0;
        uint generalFeePoolAmount = 0;
        uint complianceFeePoolAmount = 0;
        while (bucketsPayed < MAX_REWARD_BUCKET_ITERATIONS && lastPayedAt < now) {
            uint256 bucketStart = _bucketTime(lastPayedAt);
            uint256 bucketEnd = bucketStart.add(bucketTimePeriod);
            uint256 payUntil = Math.min(bucketEnd, now);
            uint256 bucketDuration = payUntil.sub(lastPayedAt);
            uint256 remainingBucketTime = bucketEnd.sub(lastPayedAt);

            uint256 amount = generalFeePoolBuckets[bucketStart] * bucketDuration / remainingBucketTime;
            generalFeePoolAmount += amount;
            generalFeePoolBuckets[bucketStart] = generalFeePoolBuckets[bucketStart].sub(amount);

            amount = complianceFeePoolBuckets[bucketStart] * bucketDuration / remainingBucketTime;
            complianceFeePoolAmount += amount;
            complianceFeePoolBuckets[bucketStart] = complianceFeePoolBuckets[bucketStart].sub(amount);

            lastPayedAt = payUntil;

            assert(lastPayedAt <= bucketEnd);
            if (lastPayedAt == bucketEnd) {
                delete generalFeePoolBuckets[bucketStart];
                delete complianceFeePoolBuckets[bucketStart];
            }

            bucketsPayed++;
        }

        assignAmountFixed(generalFeePoolAmount, CommitteeType.General);
        assignAmountFixed(complianceFeePoolAmount, CommitteeType.Compliance);
    }

    function assignAmountFixed(uint256 amount, CommitteeType complianceType) private {
        address[] memory currentCommittee = _getCommittee(complianceType);

        uint256[] memory assignedFees = new uint256[](currentCommittee.length);

        uint256 totalAssigned = 0;

        for (uint i = 0; i < currentCommittee.length; i++) {
            uint256 curAmount = amount.div(currentCommittee.length);
            assignedFees[i] = curAmount;
            totalAssigned = totalAssigned.add(curAmount);
        }

        uint256 remainder = amount.sub(totalAssigned);
        if (remainder > 0 && currentCommittee.length > 0) {
            uint ind = now % currentCommittee.length;
            assignedFees[ind] = assignedFees[ind].add(remainder);
        }

        for (uint i = 0; i < currentCommittee.length; i++) {
            addToBalance(currentCommittee[i], assignedFees[i]);
        }
        emit FeesAssigned(currentCommittee, assignedFees);
    }

    function addToBalance(address addr, uint256 amount) private {
        orbsBalance[addr] = orbsBalance[addr].add(amount);
    }

    function fillGeneralFeeBuckets(uint256 amount, uint256 monthlyRate, uint256 fromTimestamp) external {
        fillFeeBuckets(amount, monthlyRate, fromTimestamp, CommitteeType.General);
    }

    function fillComplianceFeeBuckets(uint256 amount, uint256 monthlyRate, uint256 fromTimestamp) external {
        fillFeeBuckets(amount, monthlyRate, fromTimestamp, CommitteeType.Compliance);
    }

    function fillBucket(uint256 bucketId, uint256 amount, CommitteeType complianceType) private {
        uint256 total;
        string memory complianceStr;
        if (complianceType == CommitteeType.General) {
            generalFeePoolBuckets[bucketId] = generalFeePoolBuckets[bucketId].add(amount);
            total = generalFeePoolBuckets[bucketId];
            complianceStr = "General";
        } else {
            assert(complianceType == CommitteeType.Compliance);
            complianceFeePoolBuckets[bucketId] = complianceFeePoolBuckets[bucketId].add(amount);
            total = complianceFeePoolBuckets[bucketId];
            complianceStr = "Compliance";
        }

        emit FeesAddedToBucket(bucketId, amount, total, complianceStr);
    }

    function fillFeeBuckets(uint256 amount, uint256 monthlyRate, uint256 fromTimestamp, CommitteeType complianceType) private {
        _assignFees(); // to handle rate change in the middle of a bucket time period (TBD - this is nice to have, consider removing)

        uint256 bucket = _bucketTime(fromTimestamp);
        uint256 _amount = amount;

        // add the partial amount to the first bucket
        uint256 bucketAmount = Math.min(amount, monthlyRate.mul(bucketTimePeriod - fromTimestamp % bucketTimePeriod).div(bucketTimePeriod));
        fillBucket(bucket, bucketAmount, complianceType);
        _amount = _amount.sub(bucketAmount);

        // following buckets are added with the monthly rate
        while (_amount > 0) {
            bucket = bucket.add(bucketTimePeriod);
            bucketAmount = Math.min(monthlyRate, _amount);
            fillBucket(bucket, bucketAmount, complianceType);
            _amount = _amount.sub(bucketAmount);
        }

        assert(_amount == 0);
    }

    function withdrawFunds() external {
        uint256 amount = orbsBalance[msg.sender];
        orbsBalance[msg.sender] = 0;
        require(erc20.transfer(msg.sender, amount), "Rewards::claimExternalTokenRewards - insufficient funds");
    }

    function _bucketTime(uint256 time) private pure returns (uint256) {
        return time - time % bucketTimePeriod;
    }

    function _getCommittee(CommitteeType committeeType) private view returns (address[] memory) {
        // todo - use committee contracts, for both general and kyc committees
        if (committeeType == CommitteeType.General) {
            IElections e = IElections(contractRegistry.get("elections"));
            (address[] memory validators, ) =  e.getCommittee();
            return validators;
        } else {
            return new address[](0);
        }
    }

}
