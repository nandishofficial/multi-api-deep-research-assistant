/** Applies database migrations:  npm run db:migrate */
import { runMigrations } from "../src/server/db/client";

runMigrations()
  .then(() => {
    console.log("Migrations applied");
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
