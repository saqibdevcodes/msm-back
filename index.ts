import express from "express";
import router from "./src/routes/index.ts";
import { transporter } from "./src/utils/mail.ts";
const app = express();
import cors from "cors";
app.use(
  cors({
    origin: "http://localhost:5173",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

app.use(express.json());
app.use(router);

// const info = await transporter.verify();
// console.log("Email transporter is ready:", info);

app.listen(3000, () => {
  console.log("Server is running on port 3000");
});
