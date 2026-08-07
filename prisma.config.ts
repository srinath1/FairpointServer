import "dotenv/config";
import { defineConfig } from "prisma/config";

const clean = (v: string | undefined) =>
  (v ?? "").replace(/^["']|["']$/g, "");

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: clean(process.env["DATABASE_URL"]),
  },
});
