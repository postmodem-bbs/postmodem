// SPDX-License-Identifier: AGPL-3.0-or-later
import { BlockList, isIP, SocketAddress } from "node:net";
import type { Config } from "@postmodem/core";

function parseAddress(address: string): SocketAddress | undefined {
  const version = isIP(address);
  if (version && !address.includes("%")) {
    return new SocketAddress({ address, family: version === 4 ? "ipv4" : "ipv6" });
  }
}

/** Accept only the configured suffix of a chain whose proxies append their peer addresses. */
export function clientAddressResolver({
  proxyHops,
  trustedProxies,
}: Pick<Config, "proxyHops" | "trustedProxies">) {
  const trusted = new BlockList();
  for (const entry of trustedProxies) {
    const [address = entry, prefix] = entry.split("/");
    const family = isIP(address) === 4 ? "ipv4" : "ipv6";
    if (prefix === undefined) trusted.addAddress(address, family);
    else trusted.addSubnet(address, Number(prefix), family);
  }

  return (peer: string, forwarded: string | undefined): string => {
    if (!proxyHops || !forwarded) return peer;
    const chain = forwarded.split(",");
    let address = parseAddress(peer);
    for (let hop = 0; hop < proxyHops; hop++) {
      if (!address || !trusted.check(address)) return peer;
      address = parseAddress(chain.pop()?.trim() ?? "");
    }
    return address?.address ?? peer;
  };
}
