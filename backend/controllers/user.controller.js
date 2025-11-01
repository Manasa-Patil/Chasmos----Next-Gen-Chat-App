import asyncHandler from "express-async-handler";
import User from "../models/user.model.js";
import generateToken from "../config/generatetoken.js";
export const allUsers = asyncHandler(async (req, res) => {
  const keyword = req.query.search
    ? {
        $or: [
          { name: { $regex: req.query.search, $options: "i" } },
          { email: { $regex: req.query.search, $options: "i" } },
        ],
      }
    : {};

  const users = await User.find(keyword)
    .find({ _id: { $ne: req.user._id } })
    .select("-password"); // Don't send password field

  res.status(200).json(users);
});

export const registerUser = asyncHandler(async (req, res) => {
  const { name, email, password, phoneNumber, avatar } = req.body;

  // Validate required fields
  if (!name || !email || !password || !phoneNumber) {
    res.status(400);
    throw new Error("Please enter all the required fields");
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    res.status(400);
    throw new Error("Please enter a valid email address");
  }

  // Validate password strength (minimum 6 characters)
  if (password.length < 6) {
    res.status(400);
    throw new Error("Password must be at least 6 characters long");
  }

  // Check if user already exists (by email or phone)
  const userExists = await User.findOne({
    $or: [
      { email: email.toLowerCase() },
      { phoneNumber: phoneNumber }
    ]
  });

  if (userExists) {
    res.status(400);
    throw new Error("User already exists with this email or phone number");
  }

  // Create new user
  const user = await User.create({
    name: name.trim(),
    email: email.toLowerCase().trim(),
    password,
    phoneNumber,
    avatar: avatar || "https://icon-library.com/images/anonymous-avatar-icon/anonymous-avatar-icon-25.jpg"
  });

  if (user) {
    res.status(201).json({
      _id: user._id,
      name: user.name,
      email: user.email,
      isAdmin: user.isAdmin,
      avatar: user.avatar,
      phoneNumber: user.phoneNumber,
      token: generateToken(user._id),
    });
  } else {
    res.status(400);
    throw new Error("Failed to create user");
  }
});

export const authUser = asyncHandler(async (req, res) => {
  const { emailOrPhone, password } = req.body;
  // Validate required fields
  if (!emailOrPhone || !password) {
    res.status(400);
    throw new Error("Please provide email/phone and password");
  }

  let user = null;
  if (emailOrPhone.includes("@")) {
    user = await User.findOne({ email: emailOrPhone.toLowerCase().trim() });
  } else {
    user = await User.findOne({ phoneNumber: emailOrPhone.trim() });
  }
  if (user && (await user.matchPassword(password))) {
    res.status(200).json({
      _id: user._id,
      name: user.name,
      email: user.email,
      isAdmin: user.isAdmin,
      avatar: user.avatar,
      phoneNumber: user.phoneNumber,
      token: generateToken(user._id),
    });
  } else {
    res.status(401);
    throw new Error("Invalid email/phone or password");
  }
});

export const getUserProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select("-password");

  if (user) {
    res.status(200).json(user);
  } else {
    res.status(404);
    throw new Error("User not found");
  }
});

export const updateUserProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);

  if (user) {
    user.name = req.body.name || user.name;
    user.email = req.body.email || user.email;
    user.pic = req.body.pic || user.pic;

    // Only update password if provided
    if (req.body.password) {
      if (req.body.password.length < 6) {
        res.status(400);
        throw new Error("Password must be at least 6 characters long");
      }
      user.password = req.body.password;
    }

    const updatedUser = await user.save();

    res.status(200).json({
      _id: updatedUser._id,
      name: updatedUser.name,
      email: updatedUser.email,
      pic: updatedUser.pic,
      isAdmin: updatedUser.isAdmin,
      token: generateToken(updatedUser._id),
    });
  } else {
    res.status(404);
    throw new Error("User not found");
  }
});

// Send a chat/invite request to another user (adds sender's email to recipient.receivedChatRequests)
export const sendChatRequest = asyncHandler(async (req, res) => {
  const { recipientEmail } = req.body;

  if (!recipientEmail) {
    res.status(400);
    throw new Error("Please provide recipientEmail");
  }

  // Prevent sending request to self
  if (recipientEmail.toLowerCase().trim() === req.user.email.toLowerCase().trim()) {
    res.status(400);
    throw new Error("You cannot send a chat request to yourself");
  }

  const recipient = await User.findOne({ email: recipientEmail.toLowerCase().trim() });
  if (!recipient) {
    res.status(404);
    throw new Error("Recipient user not found");
  }

  recipient.receivedChatRequests = recipient.receivedChatRequests || [];

  // Avoid duplicate requests
  if (recipient.receivedChatRequests.includes(req.user.email)) {
    res.status(400);
    throw new Error("Chat request already sent to this user");
  }

  recipient.receivedChatRequests.push(req.user.email);
  await recipient.save();

  // Also record the sent request for the sender
  const sender = await User.findById(req.user._id);
  if (sender) {
    sender.sentChatRequests = sender.sentChatRequests || [];
    if (!sender.sentChatRequests.includes(recipientEmail)) {
      sender.sentChatRequests.push(recipientEmail);
      await sender.save();
    }
  }

  res.status(200).json({ message: "Chat request sent" });
});

// Accept a received chat request: remove the sender's email from current user's receivedChatRequests
export const acceptChatRequest = asyncHandler(async (req, res) => {
  const { senderEmail } = req.body;

  if (!senderEmail) {
    res.status(400);
    throw new Error("Please provide senderEmail");
  }

  const user = await User.findById(req.user._id);
  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }

  user.receivedChatRequests = user.receivedChatRequests || [];

  if (!user.receivedChatRequests.includes(senderEmail)) {
    res.status(404);
    throw new Error("Chat request from this sender not found");
  }

  // Remove the sender's email from receivedChatRequests
  user.receivedChatRequests = user.receivedChatRequests.filter(
    (email) => email !== senderEmail
  );

  await user.save();
  // Update sender: move the recipient from sender.sentChatRequests to sender.acceptedChatRequests
  const sender = await User.findOne({ email: senderEmail.toLowerCase().trim() });
  if (sender) {
    sender.sentChatRequests = sender.sentChatRequests || [];
    sender.acceptedChatRequests = sender.acceptedChatRequests || [];

    // Remove this recipient from sender.sentChatRequests if present
    sender.sentChatRequests = sender.sentChatRequests.filter(
      (email) => email !== user.email
    );

    // Add to acceptedChatRequests if not already present
    if (!sender.acceptedChatRequests.includes(user.email)) {
      sender.acceptedChatRequests.push(user.email);
    }

    await sender.save();

    // Emit socket event to sender if io is available on the app
    try {
      const io = req.app && req.app.get && req.app.get("io");
      if (io) {
        // Assumes sender joins a room with their user id string when they connect
        io.to(sender._id.toString()).emit("chatRequestAccepted", {
          from: user.email,
          message: `${user.email} accepted your chat request`,
        });
      }
    } catch (err) {
      // Non-fatal: don't block acceptance if socket emit fails
      console.error("Socket emit failed:", err);
    }
  }

  // Optionally, here you might add each other to a contacts list. For now, just remove the request and update sender.
  res.status(200).json({ message: "Chat request accepted", receivedChatRequests: user.receivedChatRequests });
});

// Fetch accepted chat requests that other users accepted which were sent by the current user
export const getAcceptedChatRequestsSentByUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select("acceptedChatRequests");
  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }

  res.status(200).json(user.acceptedChatRequests || []);
});

// Get list of received chat requests for current user
export const getReceivedChatRequests = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select("receivedChatRequests");
  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }

  res.status(200).json(user.receivedChatRequests || []);
});