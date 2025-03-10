import { Server } from "socket.io"
import type { NextApiRequest } from "next"
import type { NextApiResponse } from "next"

const SocketHandler = (req: NextApiRequest, res: NextApiResponse) => {
  if (res.socket.server.io) {
    console.log("Socket is already running")
    res.end()
    return
  }

  const io = new Server(res.socket.server)
  res.socket.server.io = io

  const codeToSocket = new Map()

  io.on("connection", (socket) => {
    console.log("New client connected")

    socket.on("generate-code", () => {
      // Generate a random 6-digit code in format XXX-XXX
      const firstPart = Math.floor(Math.random() * 1000)
        .toString()
        .padStart(3, "0")
      const secondPart = Math.floor(Math.random() * 1000)
        .toString()
        .padStart(3, "0")
      const code = `${firstPart}-${secondPart}`

      // Store the code with the socket id
      codeToSocket.set(code, socket.id)

      // Send the code back to the client
      socket.emit("code-generated", code)
    })

    socket.on("join-with-code", ({ code, signal }) => {
      const receiverId = codeToSocket.get(code)

      if (receiverId) {
        // Notify the receiver that someone wants to connect
        io.to(receiverId).emit("peer-connected", socket.id)

        // Send the signal data to the receiver
        io.to(receiverId).emit("signal", { from: socket.id, signal })
      } else {
        // Invalid code
        socket.emit("invalid-code")
      }
    })

    socket.on("signal", ({ to, signal }) => {
      io.to(to).emit("signal", { from: socket.id, signal })
    })

    socket.on("disconnect", () => {
      // Remove any codes associated with this socket
      for (const [code, id] of codeToSocket.entries()) {
        if (id === socket.id) {
          codeToSocket.delete(code)
        }
      }
    })
  })

  console.log("Setting up socket")
  res.end()
}

export default SocketHandler

