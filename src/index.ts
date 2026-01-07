import { CronJob } from "cron";
import { backup, restore } from "./backup.js";
import { env } from "./env.js";

console.log("NodeJS Version: " + process.version);

const tryBackup = async () => {
  try {
    await backup();
  } catch (error) {
    console.error("Error while running backup: ", error);
    process.exit(1);
  }
}

const tryRestore = async () => {
  try {
    await restore();
  } catch (error) {
    console.error("Error while running restore: ", error);
    process.exit(1);
  }
}

if (env.RESTORE_ON_STARTUP) {
  console.log("Running restore on startup...");

  await tryRestore();

  console.log("Database restore complete, exiting...");
  process.exit(0);
}

if (env.RUN_ON_STARTUP || env.SINGLE_SHOT_MODE) {
  console.log("Running on start backup...");

  await tryBackup();

  if (env.SINGLE_SHOT_MODE) {
    console.log("Database backup complete, exiting...");
    process.exit(0);
  }
}

const job = new CronJob(env.BACKUP_CRON_SCHEDULE, async () => {
  await tryBackup();
});

job.start();

console.log("Backup cron scheduled...");