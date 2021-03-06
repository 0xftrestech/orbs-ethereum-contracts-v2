[![Version](https://img.shields.io/npm/v/@orbs-network/orbs-ethereum-contracts-v2)](https://www.npmjs.com/package/@orbs-network/orbs-ethereum-contracts-v2)
![Licence](https://img.shields.io/npm/l/@orbs-network/orbs-ethereum-contracts-v2)
# orbs-ethereum-contracts-v2
Orbs PoS V2 contracts and testkit

### To use the test-kit 
```bash
npm install @orbs-network/orbs-ethereum-contracts-v2
```

#### Known issues
- many capabilities are still not exported. Please be patient and tell us about needed features
- currently the Driver object does not shutdown correctly, sometimes calling process.exit() will be required, until we expose a `shutdown` method

#### setup ganache
Ganache must run in order for the testkit to function.
By default the test-kit will assume Ganache is running locally with these default settings: 
```bash
ganache-cli -p 7545 -i 5777 -a 100 -m  "vanish junk genuine web seminar cook absurd royal ability series taste method identify elevator liquid"
```

##### alternative options to running ganache:
- Launch Ganache programatically: 
```javascript
import { ganache } from "@orbs-network/orbs-ethereum-contracts-v2";
...
await ganache.startGanache()
...
await ganache.stopGanache()
```
- Access a remote Ethereum node/network:
  - `ETHEREUM_MNEMONIC` (default: `vanish junk genuine web seminar cook absurd royal ability series taste method identify elevator liquid`)
  - `ETHEREUM_URL` (default: `http://localhost:7545`)

#### Usage Example - javascript:

```javascript
const BN = require('bn.js').BN;
const Driver = require('@orbs-network/orbs-ethereum-contracts-v2').Driver;

async function createVC() {
    const d = await Driver.new(); // deploys all contracts and returns a driver object

    const monthlyRate = new BN(1000);
    const firstPayment = monthlyRate.mul(new BN(2));

    const subscriber = await d.newSubscriber('defaultTier', monthlyRate);

    // buy subscription for a new VC
    const appOwner = d.newParticipant();

    await d.erc20.assign(appOwner.address, firstPayment); // mint fake ORBS

    await d.erc20.approve(subscriber.address, firstPayment, {
        from: appOwner.address
    });

    return subscriber.createVC(firstPayment, "main", {
        from: appOwner.address
    });
}


// just print the tx Hash and exit

createVC().then((r)=>{
    console.log('Success, txHash', r.transactionHash);
    process.exit(0);
}).catch((e)=>{
    console.error(e);
    process.exit(1);
});
```
