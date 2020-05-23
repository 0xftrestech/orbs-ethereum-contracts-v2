pragma solidity 0.5.16;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/ownership/Ownable.sol";
import "@openzeppelin/contracts/math/Math.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "./IStakingContract.sol";
import "./spec_interfaces/IStakingRewards.sol";
import "./spec_interfaces/ICommittee.sol";
import "./ContractRegistryAccessor.sol";

contract StakingRewards is IStakingRewards, ContractRegistryAccessor {
    using SafeMath for uint256;

    uint256 pool;
    uint256 annualRateInPercentMille;
    uint256 annualCap;

    uint256 lastPayedAt;

    mapping(address => uint256) orbsBalance;

    IERC20 erc20;
    address rewardsGovernor;

    modifier onlyElectionsContract() {
        require(msg.sender == address(getElectionsContract()), "caller is not the elections");

        _;
    }

    modifier onlyRewardsGovernor() {
        require(msg.sender == rewardsGovernor, "caller is not the rewards governor");

        _;
    }

    constructor(IERC20 _erc20, address _rewardsGovernor) public {
        require(address(_erc20) != address(0), "erc20 must not be 0");

        erc20 = _erc20;
        lastPayedAt = now;
        rewardsGovernor = _rewardsGovernor;
    }

    function setAnnualRate(uint256 annual_rate_in_percent_mille, uint256 annual_cap) external onlyRewardsGovernor {
        (address[] memory committee, uint256[] memory weights,) = getCommitteeContract().getCommittee();
        _assignRewards(committee, weights);
        annualRateInPercentMille = annual_rate_in_percent_mille;
        annualCap = annual_cap;
    }

    function topUpPool(uint256 amount) external {
        pool = pool.add(amount);
        require(erc20.transferFrom(msg.sender, address(this), amount), "Rewards::topUpProRataPool - insufficient allowance");
    }

    function getRewardBalance(address addr) external view returns (uint256) {
        return orbsBalance[addr];
    }

    function getLastRewardsAssignment() external view returns (uint256) {
        return lastPayedAt;
    }

    function assignRewards(address[] calldata committee, uint256[] calldata weights) external onlyElectionsContract {
        _assignRewards(committee, weights);
    }
    event GasReport(string label, uint gas);

    function _assignRewards(address[] memory committee, uint256[] memory weights) private {
        // TODO we often do integer division for rate related calculation, which floors the result. Do we need to address this?
        // TODO for an empty committee or a committee with 0 total stake the divided amounts will be locked in the contract FOREVER
        uint g = gasleft();
        uint256 totalAssigned = 0;
        uint256 totalWeight = 0;
        for (uint i = 0; i < committee.length; i++) {
            totalWeight = totalWeight.add(weights[i]);
        }
//        emit GasReport("StakingRewards: total weight summation", g - gasleft());
        g = gasleft();
        if (totalWeight > 0) { // TODO - handle the case of totalStake == 0. consider also an empty committee. consider returning a boolean saying if the amount was successfully distributed or not and handle on caller side.
            uint256 duration = now.sub(lastPayedAt);

            uint256 annualAmount = Math.min(annualRateInPercentMille.mul(totalWeight).div(100000), annualCap);
            uint _pool = pool;
            uint256 amount = Math.min(annualAmount.mul(duration).div(365 days), _pool);
            pool = _pool.sub(amount);
//            emit GasReport("StakingRewards: util allocation", g - gasleft());
            g = gasleft();
            uint256[] memory assignedRewards = new uint256[](committee.length);
//            emit GasReport("StakingRewards: rewards array allocation", g - gasleft());
            g = gasleft();
            uint n;
            for (uint i = 0; i < committee.length; i++) {
                n = amount.mul(weights[i]).div(totalWeight);
                assignedRewards[i] = n;
                totalAssigned = totalAssigned.add(n);
            }
//            emit GasReport("StakingRewards: first iteration", g - gasleft());
            g = gasleft();

            n = amount.sub(totalAssigned);
            if (n > 0 && committee.length > 0) {
                uint ind = now % committee.length;
                assignedRewards[ind] = assignedRewards[ind].add(n);
            }
//            emit GasReport("StakingRewards: remainder calculation", g - gasleft());
            g = gasleft();

            for (uint i = 0; i < committee.length; i++) {
                n = orbsBalance[committee[i]] + assignedRewards[i];
                orbsBalance[committee[i]] = n;
                emit StakingRewardAssigned(committee[i], assignedRewards[i], n); // TODO event per committee?
            }
//            emit GasReport("StakingRewards: second interation", g - gasleft());
            g = gasleft();

        }

        lastPayedAt = now;
//        emit GasReport("StakingRewards: end", g - gasleft());

    }

    struct DistributorBatchState {
        uint256 fromBlock;
        uint256 toBlock;
        uint256 nextTxIndex;
        uint split;
    }
    mapping (address => DistributorBatchState) distributorBatchState;

    function distributeOrbsTokenRewards(uint256 totalAmount, uint256 fromBlock, uint256 toBlock, uint split, uint txIndex, address[] calldata to, uint256[] calldata amounts) external {
        require(to.length == amounts.length, "expected to and amounts to be of same length");

        DistributorBatchState memory ds = distributorBatchState[msg.sender];
        bool firstTxBySender = ds.nextTxIndex == 0;

        require(!firstTxBySender || fromBlock == 0, "on the first batch fromBlock must be 0");

        if (firstTxBySender || fromBlock == ds.toBlock + 1) { // New distribution batch
            require(txIndex == 0, "txIndex must be 0 for the first transaction of a new distribution batch");
            require(toBlock < block.number, "toBlock must be in the past");
            require(toBlock >= fromBlock, "toBlock must be at least fromBlock");
            ds.fromBlock = fromBlock;
            ds.toBlock = toBlock;
            ds.split = split;
            ds.nextTxIndex = 1;
            distributorBatchState[msg.sender] = ds;
        } else {
            require(txIndex == ds.nextTxIndex, "txIndex mismatch");
            require(toBlock == ds.toBlock, "toBlock mismatch");
            require(fromBlock == ds.fromBlock, "fromBlock mismatch");
            require(split == ds.split, "split mismatch");
            distributorBatchState[msg.sender].nextTxIndex = txIndex + 1;
        }

        require(totalAmount <= orbsBalance[msg.sender], "not enough balance for this distribution");

        orbsBalance[msg.sender] = orbsBalance[msg.sender].sub(totalAmount);

        IStakingContract stakingContract = getStakingContract();
        erc20.approve(address(stakingContract), totalAmount);
        stakingContract.distributeRewards(totalAmount, to, amounts); // TODO should we rely on staking contract to verify total amount?

        emit StakingRewardsDistributed(msg.sender, fromBlock, toBlock, split, txIndex, to, amounts);
    }

}
