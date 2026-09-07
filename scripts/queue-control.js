const config = require("../src/config");
const { Queue } = require("../src/queue");
const queue = new Queue(config.queueFile);
const command = process.argv[2] || "status";
if (!["pause", "resume", "status", "checkpoint"].includes(command)) throw new Error("Use pause, resume, status, or checkpoint.");
if (command === "pause" || command === "resume") queue.setting("paused", command === "pause");
if (command === "checkpoint") queue.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
console.log(JSON.stringify(queue.metrics(), null, 2));
queue.close();
