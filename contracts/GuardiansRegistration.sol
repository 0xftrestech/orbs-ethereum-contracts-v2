// SPDX-License-Identifier: UNLICENSED

pragma solidity 0.6.12;

import "./spec_interfaces/IGuardiansRegistration.sol";
import "./spec_interfaces/IElections.sol";
import "./ContractRegistryAccessor.sol";
import "./Lockable.sol";
import "./ManagedContract.sol";

contract GuardiansRegistration is IGuardiansRegistration, ManagedContract {

	modifier onlyRegisteredGuardian {
		require(isRegistered(msg.sender), "Guardian is not registered");

		_;
	}

	struct Guardian {
		address orbsAddr;
		bytes4 ip;
		string name;
		string website;
		uint256 registrationTime;
		uint256 lastUpdateTime;
	}
	mapping (address => Guardian) public guardians;
	mapping (address => address) public orbsAddressToGuardianAddress;
	mapping (bytes4 => address) public ipToGuardian;
	mapping (address => mapping(string => string)) public guardianMetadata;

	constructor(IContractRegistry _contractRegistry, address _registryAdmin, IGuardiansRegistration previousContract, address[] memory guardiansToMigrate) ManagedContract(_contractRegistry, _registryAdmin) public {
		require(previousContract != IGuardiansRegistration(0) || guardiansToMigrate.length == 0, "A guardian address list was provided for migration without the previous contract");

		for (uint i = 0; i < guardiansToMigrate.length; i++) {
			migrateGuardianData(previousContract, guardiansToMigrate[i]);
			migrateGuardianMetadata(previousContract, guardiansToMigrate[i]);
		}
	}

	function migrateGuardianData(IGuardiansRegistration previousContract, address guardianAddress) private {
		(bytes4 ip, address orbsAddr, string memory name, string memory website, uint registrationTime, uint lastUpdateTime) = previousContract.getGuardianData(guardianAddress);
		guardians[guardianAddress] = Guardian({
			orbsAddr: orbsAddr,
			ip: ip,
			name: name,
			website: website,
			registrationTime: registrationTime,
			lastUpdateTime: lastUpdateTime
		});
		orbsAddressToGuardianAddress[orbsAddr] = guardianAddress;
		ipToGuardian[ip] = guardianAddress;

		emit GuardianDataUpdated(guardianAddress, true, ip, orbsAddr, name, website);
	}

	string constant ID_FORM_URL_METADATA_KEY = "ID_FORM_URL";
	function migrateGuardianMetadata(IGuardiansRegistration previousContract, address guardianAddress) private {
		string memory rewardsFreqMetadata = previousContract.getMetadata(guardianAddress, ID_FORM_URL_METADATA_KEY);
		if (bytes(rewardsFreqMetadata).length > 0) {
			_setMetadata(guardianAddress, ID_FORM_URL_METADATA_KEY, rewardsFreqMetadata);
		}
	}

	/*
     * External methods
     */

    /// @dev Called by a participant who wishes to register as a guardian
	function registerGuardian(bytes4 ip, address orbsAddr, string calldata name, string calldata website) external override onlyWhenActive {
		require(!isRegistered(msg.sender), "registerGuardian: Guardian is already registered");

		guardians[msg.sender].registrationTime = now;
		emit GuardianRegistered(msg.sender);

		_updateGuardian(msg.sender, ip, orbsAddr, name, website);

		electionsContract.guardianRegistered(msg.sender);
	}

    /// @dev Called by a participant who wishes to update its properties
	function updateGuardian(bytes4 ip, address orbsAddr, string calldata name, string calldata website) external override onlyRegisteredGuardian onlyWhenActive {
		_updateGuardian(msg.sender, ip, orbsAddr, name, website);
	}

	function updateGuardianIp(bytes4 ip) external override onlyWhenActive {
		address guardianAddr = resolveGuardianAddress(msg.sender);
		Guardian memory data = guardians[guardianAddr];
		_updateGuardian(guardianAddr, ip, data.orbsAddr, data.name, data.website);
	}

    /// @dev Called by a guardian to update additional guardian metadata properties.
    function setMetadata(string calldata key, string calldata value) external override onlyRegisteredGuardian onlyWhenActive {
		_setMetadata(msg.sender, key, value);
	}

    function _setMetadata(address guardian, string memory key, string memory value) private {
		string memory oldValue = guardianMetadata[guardian][key];
		guardianMetadata[guardian][key] = value;
		emit GuardianMetadataChanged(guardian, key, value, oldValue);
	}

	function getMetadata(address addr, string calldata key) external override view returns (string memory) {
		require(isRegistered(addr), "getMetadata: Guardian is not registered");
		return guardianMetadata[addr][key];
	}

	/// @dev Called by a participant who wishes to unregister
	function unregisterGuardian() external override onlyRegisteredGuardian onlyWhenActive {
		delete orbsAddressToGuardianAddress[guardians[msg.sender].orbsAddr];
		delete ipToGuardian[guardians[msg.sender].ip];
		Guardian memory guardian = guardians[msg.sender];
		delete guardians[msg.sender];

		electionsContract.guardianUnregistered(msg.sender);
		emit GuardianDataUpdated(msg.sender, false, guardian.ip, guardian.orbsAddr, guardian.name, guardian.website);
		emit GuardianUnregistered(msg.sender);
	}

    /// @dev Returns a guardian's data
    /// Used also by the Election contract
	function getGuardianData(address addr) external override view returns (bytes4 ip, address orbsAddr, string memory name, string memory website, uint registration_time, uint last_update_time) {
		require(isRegistered(addr), "getGuardianData: Guardian is not registered");
		Guardian memory v = guardians[addr];
		return (v.ip, v.orbsAddr, v.name, v.website, v.registrationTime, v.lastUpdateTime);
	}

	function getGuardiansOrbsAddress(address[] calldata addrs) external override view returns (address[] memory orbsAddrs) {
		orbsAddrs = new address[](addrs.length);
		for (uint i = 0; i < addrs.length; i++) {
			orbsAddrs[i] = guardians[addrs[i]].orbsAddr;
		}
	}

	function getGuardianIp(address addr) external override view returns (bytes4 ip) {
		require(isRegistered(addr), "getGuardianIp: Guardian is not registered");
		return guardians[addr].ip;
	}

	function getGuardianIps(address[] calldata addrs) external override view returns (bytes4[] memory ips) {
		ips = new bytes4[](addrs.length);
		for (uint i = 0; i < addrs.length; i++) {
			ips[i] = guardians[addrs[i]].ip;
		}
	}

	function isRegistered(address addr) public override view returns (bool) {
		return guardians[addr].registrationTime != 0;
	}

	function resolveGuardianAddress(address ethereumOrOrbsAddress) public override view returns (address ethereumAddress) {
		if (isRegistered(ethereumOrOrbsAddress)) {
			ethereumAddress = ethereumOrOrbsAddress;
		} else {
			ethereumAddress = orbsAddressToGuardianAddress[ethereumOrOrbsAddress];
		}

		require(ethereumAddress != address(0), "Cannot resolve address");
	}

	/*
     * Methods restricted to other Orbs contracts
     */

    /// @dev Translates a list guardians Ethereum addresses to Orbs addresses
    /// Used by the Election conract
	function getOrbsAddresses(address[] calldata ethereumAddrs) external override view returns (address[] memory orbsAddrs) {
		orbsAddrs = new address[](ethereumAddrs.length);
		for (uint i = 0; i < ethereumAddrs.length; i++) {
			orbsAddrs[i] = guardians[ethereumAddrs[i]].orbsAddr;
		}
	}

	/// @dev Translates a list guardians Orbs addresses to Ethereum addresses
	/// Used by the Election contract
	function getEthereumAddresses(address[] calldata orbsAddrs) external override view returns (address[] memory ethereumAddrs) {
		ethereumAddrs = new address[](orbsAddrs.length);
		for (uint i = 0; i < orbsAddrs.length; i++) {
			ethereumAddrs[i] = orbsAddressToGuardianAddress[orbsAddrs[i]];
		}
	}

	/*
	 * Private methods
	 */

	function _updateGuardian(address guardianAddr, bytes4 ip, address orbsAddr, string memory name, string memory website) private {
		require(orbsAddr != address(0), "orbs address must be non zero");
		require(orbsAddr != guardianAddr, "orbs address must be different than the guardian address");
		require(bytes(name).length != 0, "name must be given");

		delete ipToGuardian[guardians[guardianAddr].ip];
		require(ipToGuardian[ip] == address(0), "ip is already in use");
		ipToGuardian[ip] = guardianAddr;

		delete orbsAddressToGuardianAddress[guardians[guardianAddr].orbsAddr];
		require(orbsAddressToGuardianAddress[orbsAddr] == address(0), "orbs address is already in use");
		orbsAddressToGuardianAddress[orbsAddr] = guardianAddr;

		guardians[guardianAddr].orbsAddr = orbsAddr;
		guardians[guardianAddr].ip = ip;
		guardians[guardianAddr].name = name;
		guardians[guardianAddr].website = website;
		guardians[guardianAddr].lastUpdateTime = now;

        emit GuardianDataUpdated(guardianAddr, true, ip, orbsAddr, name, website);
    }

	IElections electionsContract;
	function refreshContracts() external override {
		electionsContract = IElections(getElectionsContract());
	}

}
