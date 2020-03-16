pragma solidity 0.5.16;

import "./IContractRegistry.sol";

/// @title Elections contract interface
interface IConformance is Ownable { 
	event ValidatorComformenceUpdare(address validator, string type);

	/*
     * External methods
     */

    /// @dev Called by a validator as part of the automatic vote unready flow
    /// Used by the Election contract
	function getValidatorComformence(address addr) returns (string type) external;

    /// @dev Called by a validator as part of the automatic vote unready flow
    /// Used by the Election contract
	function setValidatorComformence(address addr, string type) external /* Owner only */ ; 

	/*
	 * Governance
	 */
	
    /// @dev Updates the address calldata of the contract registry
	function setContractRegistry(IContractRegistry _contractRegistry) external /* onlyOwner */;

}
