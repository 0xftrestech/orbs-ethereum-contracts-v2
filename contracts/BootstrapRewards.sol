pragma solidity 0.5.16;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/ownership/Ownable.sol";
import "@openzeppelin/contracts/math/Math.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "./spec_interfaces/IContractRegistry.sol";
import "./interfaces/IElections.sol";
import "./spec_interfaces/IBootstrapRewards.sol";

contract BootstrapRewards is IBootstrapRewards, Ownable {
    using SafeMath for uint256;

    IContractRegistry contractRegistry;

    uint256 pool;

    // TODO - should the fixed pool rate be a function of the committee size?
    uint256 poolMonthlyRate; // todo - deprecate this
    uint256 generalCommitteeMonthlyRate; // todo - apply this rate
    uint256 complianceCommitteeMonthlyRate; // todo - apply this rate

    uint256 lastPayedAt;

    mapping(address => uint256) externalTokenBalance;

    IERC20 externalToken;
    address rewardsGovernor;

    // TODO - add functionality similar to ownable (transfer governance, etc)
    modifier onlyRewardsGovernor() {
        require(msg.sender == rewardsGovernor, "caller is not the rewards governor");

        _;
    }

    constructor(IERC20 _externalToken, address _rewardsGovernor) public {
        require(address(_externalToken) != address(0), "externalToken must not be 0");

        externalToken = _externalToken;
        // TODO - The initial lastPayedAt should be set in the first assignRewards.
        lastPayedAt = now;
        rewardsGovernor = _rewardsGovernor;
    }

    function setContractRegistry(IContractRegistry _contractRegistry) external onlyOwner {
        require(address(_contractRegistry) != address(0), "contractRegistry must not be 0");
        contractRegistry = _contractRegistry;
    }

    // todo - deprecate this, use setGeneralCommitteeBootstrapMonthlyRate and setComplianceCommitteeBootstrapMonthlyRate instead
    function setPoolMonthlyRate(uint256 rate) external onlyRewardsGovernor {
        _assignRewards();
        poolMonthlyRate = rate;
    }

    function setGeneralCommitteeBootstrapMonthlyRate(uint256 rate) external {
        _assignRewards();
        generalCommitteeMonthlyRate = rate;
    }

    function setComplianceCommitteeBootstrapMonthlyRate(uint256 rate) external {
        _assignRewards();
        complianceCommitteeMonthlyRate = rate;
    }

    function topUpBootstrapPool(uint256 amount) external {
        pool = pool.add(amount);
        require(externalToken.transferFrom(msg.sender, address(this), amount), "Rewards::topUpFixedPool - insufficient allowance");
        emit BootstrapAddedToPool(amount, pool);
    }

    function getBootstrapBalance(address addr) external view returns (uint256) {
        return externalTokenBalance[addr];
    }

    function getLastBootstrapAssignment() external view returns (uint256) {
        return lastPayedAt;
    }

    function assignRewards() external {
        _assignRewards();
    }

    function _assignRewards() private {
        // TODO we often do integer division for rate related calculation, which floors the result. Do we need to address this?
        // TODO for an empty committee or a committee with 0 total stake the divided amounts will be locked in the contract FOREVER

        uint256 duration = now.sub(lastPayedAt);

        uint256 amount = Math.min(poolMonthlyRate.mul(duration).div(30 days), pool);
        pool = pool.sub(amount);
        assignAmountFixed(amount);

        lastPayedAt = now;
    }

    function addToBalance(address addr, uint256 amount) private {
        externalTokenBalance[addr] = externalTokenBalance[addr].add(amount);
    }

    function assignAmountFixed(uint256 amount) private {
        address[] memory currentCommittee = _getCommittee();

        uint256[] memory assignedRewards = new uint256[](currentCommittee.length);

        uint256 totalAssigned = 0;

        for (uint i = 0; i < currentCommittee.length; i++) {
            uint256 curAmount = amount.div(currentCommittee.length);
            assignedRewards[i] = curAmount;
            totalAssigned = totalAssigned.add(curAmount);
        }

        uint256 remainder = amount.sub(totalAssigned);
        if (remainder > 0 && currentCommittee.length > 0) {
            uint ind = now % currentCommittee.length;
            assignedRewards[ind] = assignedRewards[ind].add(remainder);
        }

        for (uint i = 0; i < currentCommittee.length; i++) {
            addToBalance(currentCommittee[i], assignedRewards[i]);
        }
        emit BootstrapRewardsAssigned(currentCommittee, assignedRewards);
    }

    function withdrawFunds() external {
        uint256 amount = externalTokenBalance[msg.sender];
        externalTokenBalance[msg.sender] = externalTokenBalance[msg.sender].sub(amount);
        require(externalToken.transfer(msg.sender, amount), "Rewards::claimExternalTokenRewards - insufficient funds");
    }

    function _getCommittee() private view returns (address[] memory) {
        // todo - use committee contracts, for both general and kyc committees
        IElections e = IElections(contractRegistry.get("elections"));
        (address[] memory validators, ) =  e.getCommittee();
        return validators;
    }

}
