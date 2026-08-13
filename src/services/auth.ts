import { genSalt, hash, compare } from "bcrypt-ts";
import e from "express";
import jwt from "jsonwebtoken";

export async function hashPassword(password: string): Promise<string> {
  const salt = await genSalt(10); // generate new salt per password
  return await hash(password, salt);
}

export async function comparePassword(
  password: string,
  hashedPassword: string,
): Promise<boolean> {
  return await compare(password, hashedPassword);
}

export function generateToken(userId: string): string {
  const secretKey = process.env.JWT_SECRET || "your_jwt_secret";
  return jwt.sign({ userId }, secretKey, { expiresIn: "1h" });
}

export function verifyToken(token: string): any {
  const secretKey = process.env.JWT_SECRET || "your_jwt_secret";
  return jwt.verify(token, secretKey);
}

export function loginEmail(email: string) {
  return {
    from: `"MSM" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "Login Notification",
    text: `You have logged in at ${new Date().toLocaleString()} in MSM app. Have a nice day!`,
  };
}

export function registrationEmail(name: string, email: string) {
  return {
    from: `"MSM" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: `Welcome ${name} to MSM app!`,
    text: `Thank you ${name} for registering at MSM app! We're excited to have you on board. If you have any questions, feel free to reach out. Welcome!`,
  };
}

export function forgotPasswordEmail(email: string) {
  const resetLink = `${process.env.FRONTEND_URL}/reset-password?email=${email}`;

  return {
    from: `"MSM" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "Reset Your Password",
    text: `You requested a password reset.

Click the link below to reset your password:
${resetLink}

This link will expire soon. If you did not request this, you can ignore this email.`,
    html: `
      <div>
        <h2>Password Reset Request</h2>
        <p>You requested a password reset for your MSM account.</p>
        <p>Click the button below to reset your password:</p>
        <a href="${resetLink}" style="padding:10px 15px;background:#2563eb;color:#fff;text-decoration:none;border-radius:5px;display:inline-block;">
          Reset Password
        </a>
        <p style="margin-top:20px;color:#666;">
          This link will expire soon. If you did not request this, ignore this email.
        </p>
      </div>
    `,
  };
}

export function resetPasswordEmail(name: string, email: string) {
  return {
    from: `"MSM" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "Password Reset Notification",
    text: `You have successfully reset your password at ${new Date().toLocaleString()} in MSM app. Have a nice day!`,
  };
}
