import type { Request, Response } from "express";
import { prisma } from "../lib/prisma.ts";
import {
  generateToken,
  hashPassword,
  loginEmail,
  registrationEmail,
  resetPasswordEmail,
  forgotPasswordEmail,
} from "../services/auth.ts";
import { transporter } from "../utils/mail.ts";

export async function login(req: Request, res: Response) {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      name: true,
      token: true,
      role: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  const token = generateToken(email);

  const updatedUser = await prisma.user.update({
    where: { email },
    data: { token },
    select: { id: true, email: true, name: true, token: true, role: true },
  });

  if (!updatedUser) {
    return res.status(500).json({ error: "Failed to update user" });
  }

  if (user) {
    res.status(200).json(updatedUser);
    await transporter.sendMail(loginEmail(email));
  } else {
    res.status(404).json({ error: "User not found" });
  }
}

export async function register(req: Request, res: Response) {
  const { email, name, password } = req.body;

  if (!email || !name || !password) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const existingUser = await prisma.user.findUnique({
    where: { email },
  });

  if (existingUser) {
    return res.status(400).json({ error: "User already exists" });
  }

  const hashedPassword = await hashPassword(password);

  const user = await prisma.user.create({
    data: {
      email,
      name,
      password: hashedPassword,
    },
  });

  if (user) {
    res.status(201).json(user);
    await transporter.sendMail(registrationEmail(name, email));
  } else {
    res.status(500).json({ error: "Failed to create user" });
  }
}

export async function profile(req: Request, res: Response) {
  const id = req.params.id as string; // Access userId from route parameters

  const profile = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, name: true, role: true, status: true },
  });

  if (profile) {
    res.status(200).json(profile);
  } else {
    res.status(404).json({ error: "User not found" });
  }
}
export async function forgotPassword(req: Request, res: Response) {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  const info = await transporter.sendMail(forgotPasswordEmail(email));

  if (!info) {
    return res
      .status(500)
      .json({ error: "Failed to send password reset email" });
  }
  res.status(200).json({ message: "Password reset email sent" });
}

export async function resetPassword(req: Request, res: Response) {
  const { email, newPassword, confirmNewPassword } = req.body;

  if (!email || !newPassword || !confirmNewPassword) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true },
  });

  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  if (newPassword !== confirmNewPassword) {
    return res.status(400).json({ error: "Passwords do not match" });
  }

  const hashedPassword = await hashPassword(newPassword);

  const updatedUser = await prisma.user.update({
    where: { email },
    data: { password: hashedPassword },
  });

  const name = user.name || "User";

  if (updatedUser) {
    res.status(200).json({ message: "Password reset successful" });
    await transporter.sendMail(resetPasswordEmail(name, email));
  }

  return res.status(500).json({ error: "Failed to update user" });
}

export async function changePassword(req: Request, res: Response) {
  const { email, currentPassword, newPassword, confirmNewPassword } = req.body;

  if (!email || !currentPassword || !newPassword || !confirmNewPassword) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, password: true },
  });

  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  if (newPassword !== confirmNewPassword) {
    return res.status(400).json({ error: "Passwords do not match" });
  }

  const hashedCurrentPassword = await hashPassword(currentPassword);

  if (hashedCurrentPassword !== user.password) {
    return res.status(400).json({ error: "Current password is incorrect" });
  }

  const hashedNewPassword = await hashPassword(newPassword);

  const updatedUser = await prisma.user.update({
    where: { email },
    data: { password: hashedNewPassword },
  });

  const name = user.name || "User";

  if (updatedUser) {
    res.status(200).json({ message: "Password changed successfully" });
    await transporter.sendMail(resetPasswordEmail(name, email));
  }

  return res.status(500).json({ error: "Failed to update user" });
}

export async function logout(req: Request, res: Response) {
  const { email } = req.body;
  const user = await prisma.user.findUnique({ where: { email } });
  if (user) {
    await prisma.user.update({ where: { email }, data: { token: null } });
    res.status(200).json({ message: "Logout successful" });
  } else {
    res.status(404).json({ error: "User not found" });
  }
}
