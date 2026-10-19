-- CreateTable
CREATE TABLE "ZernioSenderGate" (
    "senderKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ZernioSenderGate_pkey" PRIMARY KEY ("senderKey")
);
