// SPDX-License-Identifier: AGPL-3.0-or-later
// k6 scenario for the performance budget (DESIGN.md §5.1): 50 concurrent readers, p95 page
// time under 150 ms on 1 vCPU, for the pages M1 slice 7 names: the index, a big forum's first
// and last page, a long topic's first and last page. Point FORUM and TOPIC at a large forum and
// a long topic (classic URLs; ids from the board you test). Defaults fit the demo board.
// For a deep topic, add one first: postmodem seed-demo --long-topic 10000 (prints its id).
//   docker run --rm --network host -v "$PWD/tools/loadtest:/scripts:ro" -e BASE_URL=http://localhost:8080 \
//     -e FORUM=1008 -e FORUM_TOPICS=1002 -e TOPIC=21001 -e TOPIC_POSTS=10000 \
//     grafana/k6:1.3.0 run /scripts/smoke.js
import { check, sleep } from "k6";
import http from "k6/http";

const BASE = __ENV.BASE_URL || "http://localhost:8080";
const FORUM = __ENV.FORUM || "4";
const FORUM_TOPICS = Number(__ENV.FORUM_TOPICS || 30);
const TOPIC = __ENV.TOPIC || "3";
const TOPIC_POSTS = Number(__ENV.TOPIC_POSTS || 31);
/** p95 limit in ms: the budget (150) locally on 1 vCPU; CI uses the alarm level (400). */
const P95 = Number(__ENV.P95_MS || 150);
/** phpBB2's `start=` offset of the last page (TOPICS_PER_PAGE 25, POSTS_PER_PAGE 15). */
const lastStart = (items, perPage) => Math.floor((Math.max(items, 1) - 1) / perPage) * perPage;

const PAGES = {
  index: "/",
  forum_first: `/viewforum.php?f=${FORUM}`,
  forum_last: `/viewforum.php?f=${FORUM}&start=${lastStart(FORUM_TOPICS, 25)}`,
  topic_first: `/viewtopic.php?t=${TOPIC}`,
  topic_last: `/viewtopic.php?t=${TOPIC}&start=${lastStart(TOPIC_POSTS, 15)}`,
};

export const options = {
  scenarios: {
    // Ramp up: 50 readers arriving in the same millisecond, all on the index, measure a
    // thundering herd on one CPU rather than the pages.
    readers: {
      executor: "ramping-vus",
      stages: [
        { duration: "10s", target: 50 },
        { duration: __ENV.DURATION || "30s", target: 50 },
      ],
    },
  },
  thresholds: {
    ...Object.fromEntries(Object.keys(PAGES).map((p) => [`http_req_duration{page:${p}}`, [`p(95)<${P95}`]])),
    http_req_failed: ["rate<0.01"],
  },
};

const NAMES = Object.keys(PAGES);

export default function () {
  // Each reader opens a random one of the pages, then reads for a moment.
  const page = NAMES[Math.floor(Math.random() * NAMES.length)];
  // No redirects: a 301 would mean the URL isn't canonical for the board's style.
  const res = http.get(`${BASE}${PAGES[page]}`, { tags: { page }, redirects: 0 });
  check(res, { [`${page} is 200`]: (r) => r.status === 200 });
  sleep(Math.random() * 2);
}
