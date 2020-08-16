import 'mocha';


import BN from "bn.js";
import {Driver, DEPLOYMENT_SUBSET_MAIN, DEPLOYMENT_SUBSET_CANARY} from "./driver";
import chai from "chai";

chai.use(require('chai-bn')(BN));
chai.use(require('./matchers'));

const expect = chai.expect;

import {bn, evmIncreaseTimeForQueries, expectRejected, getTopBlockTimestamp} from "./helpers";

describe('protocol-contract', async () => {

  // functional owner

  it('allows only the functional owner to set protocol version', async () => {
    const d = await Driver.new();

    let currTime: number = await getTopBlockTimestamp(d);
    await expectRejected(d.protocol.setProtocolVersion(DEPLOYMENT_SUBSET_MAIN, 2, currTime + 100, {from: d.migrationManager.address}), /sender is not the functional manager/);
    await d.protocol.setProtocolVersion(DEPLOYMENT_SUBSET_MAIN, 2, currTime + 100, {from: d.functionalManager.address});
  });

  // registry manager

  it('allows only the registry manager to set contract registry', async () => {
    const d = await Driver.new();

    const newAddr = d.newParticipant().address;

    await expectRejected(d.protocol.setContractRegistry(newAddr, {from: d.functionalManager.address}), /caller is not the registryManager/);
    await d.protocol.setContractRegistry(newAddr, {from: d.migrationManager.address});
  });

  it('only current registry manager can transfer registry ownership', async () => {
    const d = await Driver.new();

    const newOwner = d.newParticipant();
    await expectRejected(d.protocol.transferRegistryManagement(newOwner.address, {from: d.functionalManager.address}), /caller is not the registryManager/);
    await d.protocol.transferRegistryManagement(newOwner.address, {from: d.migrationManager.address});

  });

  it('does not transfer registry ownership until claimed by new owner', async () => {
    const d = await Driver.new();

    const newManager = d.newParticipant();
    await d.protocol.transferRegistryManagement(newManager.address, {from: d.migrationManager.address});

    const newAddr = d.newParticipant().address;
    await expectRejected(d.protocol.setContractRegistry(newAddr, {from: newManager.address}), /caller is not the registryManager/);
    await d.protocol.setContractRegistry(newAddr, {from: d.migrationManager.address});

    const notNewOwner = d.newParticipant();
    await expectRejected(d.protocol.claimRegistryManagement({from: notNewOwner.address}), /Caller is not the pending registryManager/);

    await d.protocol.claimRegistryManagement({from: newManager.address});
    await expectRejected(d.protocol.setContractRegistry(newAddr, {from: d.migrationManager.address}), /caller is not the registryManager/);
    await d.protocol.setContractRegistry(newAddr, {from: newManager.address});
  });


});
