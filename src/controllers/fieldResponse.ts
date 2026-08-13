import type { Request, Response } from "express";
import { prisma } from "../lib/prisma.ts";

const syncProjectReceived = async (projectId: string) => {
  const result = await prisma.fieldResponse.aggregate({
    where: { projectId },
    _sum: { quantity: true },
  });

  await prisma.project.update({
    where: { id: projectId },
    data: { received: result._sum.quantity ?? 0 },
  });
};

export const getFieldResponses = async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as { projectId: string };
    const fieldResponses = await prisma.fieldResponse.findMany({
      where: { projectId },
    });
    res.status(200).json(fieldResponses);
  } catch (error) {
    console.error("Error retrieving field responses:", error);
    res.status(500).json({ error: "Failed to retrieve field responses" });
  }
};

export const createFieldResponse = async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as { projectId: string };
    const { receivedFrom, quantity } = req.body as {
      receivedFrom?: string;
      quantity?: number;
    };

    if (!receivedFrom || typeof quantity !== "number" || quantity <= 0) {
      return res.status(400).json({
        error: "receivedFrom and positive quantity are required",
      });
    }

    const fieldResponse = await prisma.fieldResponse.create({
      data: { projectId, receivedFrom, quantity },
    });

    await syncProjectReceived(projectId);

    res.status(201).json(fieldResponse);
  } catch (error) {
    console.error("Error creating field response:", error);
    res.status(500).json({ error: "Failed to create field response" });
  }
};

export const deleteFieldResponse = async (req: Request, res: Response) => {
  try {
    const { id } = req.params as { id: string };
    const existing = await prisma.fieldResponse.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: "Field response not found" });
    }

    const fieldResponse = await prisma.fieldResponse.delete({ where: { id } });
    await syncProjectReceived(existing.projectId);
    res.status(200).json(fieldResponse);
  } catch (error) {
    console.error("Error deleting field response:", error);
    res.status(500).json({ error: "Failed to delete field response" });
  }
};

export const updateFieldResponse = async (req: Request, res: Response) => {
  try {
    const { id } = req.params as { id: string };
    const existing = await prisma.fieldResponse.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: "Field response not found" });
    }

    const { receivedFrom, quantity } = req.body;

    if (
      receivedFrom !== undefined &&
      (typeof receivedFrom !== "string" || !receivedFrom.trim())
    ) {
      return res.status(400).json({ error: "receivedFrom must be non-empty" });
    }

    if (
      quantity !== undefined &&
      (typeof quantity !== "number" || quantity <= 0)
    ) {
      return res
        .status(400)
        .json({ error: "quantity must be a positive number" });
    }

    const fieldResponse = await prisma.fieldResponse.update({
      where: { id },
      data: { receivedFrom, quantity },
    });

    await syncProjectReceived(fieldResponse.projectId);
    res.status(200).json(fieldResponse);
  } catch (error) {
    console.error("Error updating field response:", error);
    res.status(500).json({ error: "Failed to update field response" });
  }
};

export const getFieldResponseById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params as { id: string };
    const fieldResponse = await prisma.fieldResponse.findUnique({
      where: { id },
    });
    if (!fieldResponse) {
      return res.status(404).json({ error: "Field response not found" });
    }
    res.status(200).json({
      message: "Field response retrieved successfully",
      data: fieldResponse,
    });
  } catch (error) {
    console.error("Error retrieving field response:", error);
    res.status(500).json({ error: "Failed to retrieve field response" });
  }
};

export const getFieldResponsesByProjectId = async (
  req: Request,
  res: Response,
) => {
  try {
    const { projectId } = req.params as { projectId: string };
    const fieldResponses = await prisma.fieldResponse.findMany({
      where: { projectId },
    });
    res.status(200).json(fieldResponses);
  } catch (error) {
    console.error("Error retrieving field responses:", error);
    res.status(500).json({ error: "Failed to retrieve field responses" });
  }
};


