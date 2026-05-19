import { Router, type IRouter } from "express";
import healthRouter from "./health";
import usersRouter from "./users";
import dashboardRouter from "./dashboard";
import vocabularyRouter from "./vocabulary";
import lessonsRouter from "./lessons";
import chatRouter from "./chat";
import speakingRouter from "./speaking";
import gamificationRouter from "./gamification";
import leaderboardRouter from "./leaderboard";
import transcribeRouter from "./transcribe";
import productsRouter from "./products";
import searchImageRouter from "./search-image";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/users", usersRouter);
router.use("/dashboard", dashboardRouter);
router.use("/vocabulary", vocabularyRouter);
router.use("/lessons", lessonsRouter);
router.use("/chat", chatRouter);
router.use("/speaking", speakingRouter);
router.use("/gamification", gamificationRouter);
router.use("/leaderboard", leaderboardRouter);
router.use(transcribeRouter);
router.use("/products", searchImageRouter);
router.use("/products", productsRouter);

export default router;
