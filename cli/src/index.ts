#!/usr/bin/env node
// SPDX-License-Identifier: MIT

import { parseArgs } from "./parseArgs.js";

parseArgs().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
