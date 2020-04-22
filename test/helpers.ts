import Web3 from "web3";
import BN from "bn.js";
import { Web3Driver } from "../eth";

export const retry = (n: number, f: () => Promise<void>) => async  () => {
    for (let i = 0; i < n; i++) {
        await f();
    }
};

export const evmIncreaseTime = async (web3: Web3Driver, seconds: number) => new Promise(
    (resolve, reject) =>
        (web3.currentProvider as any).send(
            {method: "evm_increaseTime", params: [seconds]},
            (err, res) => err ? reject(err) : resolve(res)
        )
);

export function bn(x: string|BN|number|Array<string|BN|number>) {
    if (Array.isArray(x)) {
        return x.map(n => bn(n))
    }
    return new BN(x);
}


export function minAddress(addrs: string[]): string {
    const toBn = addr => new BN(addr.slice(2), 16);
    const minBn = addrs
        .map(toBn)
        .reduce((m, x) => BN.min(m, x), toBn(addrs[0]));
    return addrs.find(addr => toBn(addr).eq(minBn)) as string
}
