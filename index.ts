import "dotenv/config"
import { createServer } from "http"
import { Server } from "socket.io"
import { PrismaClient } from "./generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"

const rawUrl = (process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/fairpoint").replace(/^["']|["']$/g, "")
const url = new URL(rawUrl)
const adapter = new PrismaPg({
  host: url.hostname,
  port: parseInt(url.port) || 5432,
  database: url.pathname.slice(1),
  user: url.username,
  password: url.password,
  connectionTimeoutMillis: 5000,
})

const prisma = new PrismaClient({ adapter })

const httpServer = createServer()
const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] },
})

const onlineUsers = new Map<number, { userId: number; username: string; role: string; socketId: string }>()

io.on("connection", (socket) => {
  let currentUser: { userId: number; username: string; role: string } | null = null

  socket.on("join", async (userData: { userId: number; username: string; role: string }) => {
    const { userId, username, role } = userData
    if (!userId || !username || !role) return

    if (role !== "admin" && role !== "clientfp") {
      socket.emit("error", "Not authorized for chat")
      return
    }

    currentUser = { userId, username, role }
    onlineUsers.set(userId, { userId, username, role, socketId: socket.id })
    socket.join(`user:${userId}`)

    const adminUser = Array.from(onlineUsers.values()).find((u) => u.role === "admin")

    if (role === "admin") {
      const clientList = Array.from(onlineUsers.values()).filter((u) => u.role === "clientfp")
      socket.emit("online_users", clientList)
    } else {
      if (adminUser) {
        socket.emit("admin_online", { userId: adminUser.userId, username: adminUser.username })
      }
    }

    io.emit("user_status", { userId, username, role, online: true })
  })

  socket.on("send_message", async (data: { receiverId: number; message: string }) => {
    if (!currentUser) return
    const { receiverId, message } = data
    if (!receiverId || !message) return

    const receiver = onlineUsers.get(receiverId)
    const receiverRole = receiver ? receiver.role : null
    const senderRole = currentUser.role

    if (senderRole === "clientfp" && receiverRole !== "admin") {
      socket.emit("error", "You can only chat with admin")
      return
    }
    if (senderRole === "admin" && receiverRole !== "clientfp") {
      socket.emit("error", "Invalid receiver")
      return
    }

    if (!receiver) {
      socket.emit("error", "Client is not available. They are offline.")
      return
    }

    try {
      const saved = await prisma.chatMessage.create({
        data: {
          senderId: currentUser.userId,
          receiverId,
          message,
        },
      })

      const msgData = {
        id: saved.id,
        senderId: currentUser.userId,
        senderUsername: currentUser.username,
        receiverId,
        message,
        createdAt: saved.createdAt.toISOString(),
      }

      io.to(`user:${currentUser.userId}`).emit("new_message", msgData)
      io.to(`user:${receiverId}`).emit("new_message", msgData)
    } catch (err) {
      console.error("Failed to save message:", err)
      socket.emit("error", "Failed to save message")
    }
  })

  socket.on("disconnect", () => {
    if (currentUser) {
      onlineUsers.delete(currentUser.userId)
      io.emit("user_status", {
        userId: currentUser.userId,
        username: currentUser.username,
        role: currentUser.role,
        online: false,
      })
    }
  })
})

const PORT = parseInt(process.env.SOCKET_PORT || "3002")
httpServer.listen(PORT, () => {
  console.log(`Socket server running on port ${PORT}`)
})
