// SPDX-License-Identifier: AGPL-3.0-or-later
// k6 smoke scenario for the performance budget (DESIGN.md §5.1): 50 concurrent readers,
// p95 page time under 150 ms. Grows with M1's read pages (forum, topic) once they exist.
//   docker run --rm --network host -v "$PWD/tools/loadtest:/scripts:ro" -e BASE_URL=http://localhost:8080 \
//     grafana/k6:1.3.0 run /scripts/smoke.js
import { check, sleep } from "k6";
import http from "k6/http";

const BASE = __ENV.BASE_URL || "http://localhost:8080";

export const options = {
  scenarios: {
    readers: { executor: "constant-vus", vus: 50, duration: __ENV.DURATION || "30s" },
  },
  thresholds: {
    "http_req_duration{page:index}": ["p(95)<150"],
    http_req_failed: ["rate<0.01"],
  },
};

export default function () {
  const res = http.get(`${BASE}/`, { tags: { page: "index" } });
  check(res, { "index is 200": (r) => r.status === 200 });
  sleep(Math.random() * 2);
}
