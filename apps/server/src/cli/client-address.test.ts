// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, it } from "vitest";
import { clientAddressResolver } from "./client-address.ts";

const trustedProxies = ["10.8.0.0/24", "2001:db8:8::/48"];
const resolve = clientAddressResolver({ proxyHops: 2, trustedProxies });
const peer = "10.8.0.3";
const client = "192.0.2.1";

it("uses the configured number of trusted hops from the right", () => {
  const oneHop = clientAddressResolver({ proxyHops: 1, trustedProxies });
  expect(oneHop(peer, `203.0.113.1, ${client}`)).toBe(client);
  expect(resolve(peer, `203.0.113.1, ${client}, 10.8.0.2`)).toBe(client);
  expect(resolve("::ffff:a08:3", "2001:0db8:9:0::1, 2001:db8:8::2")).toBe("2001:db8:9::1");
});

it("uses the socket address when forwarding is disabled or the direct peer is untrusted", () => {
  const direct = clientAddressResolver({ proxyHops: 0, trustedProxies });
  expect(direct(peer, `${client}, 10.8.0.2`)).toBe(peer);
  expect(resolve("198.51.100.1", `${client}, 10.8.0.2`)).toBe("198.51.100.1");
});

it.each([
  undefined,
  client,
  `${client}, 198.51.100.1`,
  `${client}, invalid`,
  "not-an-address, 10.8.0.2",
  "fe80::1%eth0, 10.8.0.2",
  ", 10.8.0.2",
])("falls back to the socket for an incomplete or invalid chain (%s)", (header) => {
  expect(resolve(peer, header)).toBe(peer);
});
