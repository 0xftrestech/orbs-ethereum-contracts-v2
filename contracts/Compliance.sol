pragma solidity 0.5.16;

import "./spec_interfaces/ICompliance.sol";
import "./ContractRegistryAccessor.sol";
import "./WithClaimableFunctionalOwnership.sol";

contract Compliance is ICompliance, ContractRegistryAccessor, WithClaimableFunctionalOwnership {

    mapping (address => bool) validatorCompliance;

    /*
     * External methods
     */

    function isValidatorCompliant(address addr) external view returns (bool isCompliant) {
        return validatorCompliance[addr];
    }

    function onlyWhenActive(address addr, bool isCompliant) external onlyFunctionalOwner onlyWhenUnlocked {
        validatorCompliance[addr] = isCompliant;
        emit ValidatorComplianceUpdate(addr, isCompliant);
        getElectionsContract().validatorComplianceChanged(addr, isCompliant);
    }

}
