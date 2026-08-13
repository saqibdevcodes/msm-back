export function deleteUserEmail(name: string, email: string) {
  return {
    from: "`MSM` <${process.env.EMAIL_USER}>",
    to: email,
    subject: "Account Deletion Notification",
    text: `Hi ${name}, Your account has been deleted at ${new Date().toLocaleString()} in MSM app. Have a nice day!`,
  };
}

export function updateUserEmail(name: string, email: string) {
  return {
    from: "`MSM` <${process.env.EMAIL_USER}>",
    to: email,
    subject: "Account Update Notification",
    text: `Hi ${name}, Your account information has been updated at ${new Date().toLocaleString()} in MSM app. If you did not make this change, please contact support immediately! Now your account information is: Name: ${name}, Email: ${email}. Have a nice day!`,
  };
}

export function updateUserStatusEmail(
  name: string,
  email: string,
  isActive: boolean,
) {
  return {
    from: "`MSM` <${process.env.EMAIL_USER}>",
    to: email,
    subject: "Account Status Update Notification",
    text: `Hi ${name}, Your account status has been updated at ${new Date().toLocaleString()} in MSM app. Now your account status is: ${isActive ? "Active" : "Inactive"}. Have a nice day!`,
  };
}
