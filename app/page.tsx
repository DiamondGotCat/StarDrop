"use client"

import type React from "react"

import { useState, useRef, useEffect } from "react"
import { FileIcon, SendIcon, DownloadIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { io } from "socket.io-client"
import Peer from "simple-peer"

export default function StarDrop() {
  const [mode, setMode] = useState<"initial" | "receive" | "send" | "transferring" | "complete">("initial")
  const [code, setCode] = useState<string>("")
  const [inputCode, setInputCode] = useState<string>("")
  const [file, setFile] = useState<File | null>(null)
  const [progress, setProgress] = useState<number>(0)
  const [receivedFile, setReceivedFile] = useState<{ name: string; size: number; url: string } | null>(null)
  const [error, setError] = useState<string>("")

  const socketRef = useRef<any>(null)
  const peerRef = useRef<any>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // Initialize socket connection
    socketRef.current = io()

    socketRef.current.on("connect", () => {
      console.log("Connected to server")
    })

    socketRef.current.on("code-generated", (generatedCode: string) => {
      setCode(generatedCode)
    })

    socketRef.current.on("peer-connected", (initiatorId: string) => {
      // Create peer as non-initiator (receiver)
      const peer = new Peer({
        initiator: false,
        trickle: false,
      })

      peer.on("signal", (data) => {
        socketRef.current.emit("signal", { to: initiatorId, signal: data })
      })

      peer.on("data", handleReceiveData)

      socketRef.current.on("signal", (data: any) => {
        peer.signal(data.signal)
      })

      peerRef.current = peer
    })

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect()
      }
      if (peerRef.current) {
        peerRef.current.destroy()
      }
    }
  }, [])

  const generateCode = () => {
    setMode("receive")
    socketRef.current.emit("generate-code")
  }

  const openSendMode = () => {
    setMode("send")
    setError("")
  }

  const connectWithCode = () => {
    if (inputCode.length !== 7) {
      setError("Please enter a valid code (format: XXX-XXX)")
      return
    }

    // Create peer as initiator (sender)
    const peer = new Peer({
      initiator: true,
      trickle: false,
    })

    peer.on("signal", (data) => {
      socketRef.current.emit("join-with-code", { code: inputCode, signal: data })
    })

    socketRef.current.on("signal", (data: any) => {
      peer.signal(data.signal)
    })

    peer.on("connect", () => {
      setMode("transferring")
      if (file) {
        sendFile(peer, file)
      }
    })

    socketRef.current.on("invalid-code", () => {
      setError("Invalid code. Please try again.")
    })

    peerRef.current = peer
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0])
    }
  }

  const sendFile = (peer: any, file: File) => {
    const chunkSize = 16 * 1024 // 16KB chunks
    let offset = 0

    // First send file metadata
    peer.send(
      JSON.stringify({
        type: "metadata",
        name: file.name,
        size: file.size,
        mimeType: file.type,
      }),
    )

    const reader = new FileReader()

    reader.onload = (e) => {
      if (e.target && e.target.result) {
        peer.send(e.target.result)
        offset += chunkSize
        setProgress(Math.min(100, Math.floor((offset / file.size) * 100)))

        if (offset < file.size) {
          readNextChunk()
        } else {
          // File transfer complete
          peer.send(JSON.stringify({ type: "complete" }))
          setTimeout(() => {
            resetApp()
          }, 3000)
        }
      }
    }

    const readNextChunk = () => {
      const slice = file.slice(offset, offset + chunkSize)
      reader.readAsArrayBuffer(slice)
    }

    readNextChunk()
  }

  // Buffer to store received file chunks
  const chunksRef = useRef<Uint8Array[]>([])
  const metadataRef = useRef<{ name: string; size: number; mimeType: string } | null>(null)
  const receivedSizeRef = useRef<number>(0)

  const handleReceiveData = (data: any) => {
    try {
      // Check if this is metadata (sent as string)
      if (typeof data === "string") {
        const parsedData = JSON.parse(data)

        if (parsedData.type === "metadata") {
          metadataRef.current = {
            name: parsedData.name,
            size: parsedData.size,
            mimeType: parsedData.mimeType,
          }
          chunksRef.current = []
          receivedSizeRef.current = 0
          setMode("transferring")
          return
        }

        if (parsedData.type === "complete") {
          // Combine all chunks to create the file
          const completeFile = new Blob(chunksRef.current, {
            type: metadataRef.current?.mimeType || "application/octet-stream",
          })

          setReceivedFile({
            name: metadataRef.current?.name || "unknown",
            size: metadataRef.current?.size || 0,
            url: URL.createObjectURL(completeFile),
          })

          setMode("complete")
          setTimeout(() => {
            resetApp()
          }, 5000)
          return
        }
      }

      // Handle binary data (file chunks)
      const chunk = new Uint8Array(data)
      chunksRef.current.push(chunk)
      receivedSizeRef.current += chunk.byteLength

      if (metadataRef.current) {
        setProgress(Math.min(100, Math.floor((receivedSizeRef.current / metadataRef.current.size) * 100)))
      }
    } catch (err) {
      console.error("Error processing received data:", err)
    }
  }

  const resetApp = () => {
    setMode("initial")
    setCode("")
    setInputCode("")
    setFile(null)
    setProgress(0)
    setReceivedFile(null)
    setError("")

    if (peerRef.current) {
      peerRef.current.destroy()
      peerRef.current = null
    }

    // Clear file input
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + " bytes"
    else if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB"
    else if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + " MB"
    else return (bytes / 1073741824).toFixed(1) + " GB"
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">StarDrop</h1>
          <p className="text-slate-300">Seamless file transfer between devices</p>
        </div>

        {mode === "initial" && (
          <Card className="bg-slate-800 border-slate-700">
            <CardContent className="pt-6">
              <div className="flex flex-col items-center justify-center space-y-6 py-10">
                <div className="rounded-full bg-slate-700 p-6">
                  <FileIcon size={48} className="text-slate-300" />
                </div>
                <p className="text-slate-300 text-center">
                  Transfer files between devices securely and quickly.
                  <br />
                  No account required.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {mode === "receive" && (
          <Card className="bg-slate-800 border-slate-700">
            <CardContent className="pt-6">
              <div className="flex flex-col items-center justify-center space-y-6 py-6">
                <h2 className="text-xl font-semibold text-white">Receive Files</h2>
                <div className="text-3xl font-mono tracking-wider text-white bg-slate-700 py-3 px-6 rounded-lg">
                  {code}
                </div>
                <p className="text-slate-300 text-center">
                  Share this code with the sender.
                  <br />
                  Waiting for connection...
                </p>
                <Button variant="outline" onClick={resetApp} className="mt-4">
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {mode === "send" && (
          <Card className="bg-slate-800 border-slate-700">
            <CardContent className="pt-6">
              <div className="flex flex-col items-center justify-center space-y-6 py-6">
                <h2 className="text-xl font-semibold text-white">Send Files</h2>

                <div className="w-full space-y-4">
                  <div>
                    <label className="text-sm text-slate-300 mb-1 block">Enter receiver's code</label>
                    <Input
                      type="text"
                      placeholder="XXX-XXX"
                      value={inputCode}
                      onChange={(e) => setInputCode(e.target.value)}
                      className="bg-slate-700 border-slate-600 text-white"
                    />
                    {error && <p className="text-red-400 text-sm mt-1">{error}</p>}
                  </div>

                  <div>
                    <label className="text-sm text-slate-300 mb-1 block">Select file to send</label>
                    <Input
                      ref={fileInputRef}
                      type="file"
                      onChange={handleFileChange}
                      className="bg-slate-700 border-slate-600 text-white"
                    />
                  </div>

                  {file && (
                    <div className="bg-slate-700 p-3 rounded-md">
                      <p className="text-white font-medium truncate">{file.name}</p>
                      <p className="text-slate-300 text-sm">{formatFileSize(file.size)}</p>
                    </div>
                  )}
                </div>

                <div className="flex gap-3 mt-4">
                  <Button variant="outline" onClick={resetApp}>
                    Cancel
                  </Button>
                  <Button onClick={connectWithCode} disabled={!file || !inputCode}>
                    Connect & Send
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {mode === "transferring" && (
          <Card className="bg-slate-800 border-slate-700">
            <CardContent className="pt-6">
              <div className="flex flex-col items-center justify-center space-y-6 py-6">
                <h2 className="text-xl font-semibold text-white">{file ? "Sending File..." : "Receiving File..."}</h2>

                {file && (
                  <div className="bg-slate-700 p-3 rounded-md w-full">
                    <p className="text-white font-medium truncate">{file.name}</p>
                    <p className="text-slate-300 text-sm">{formatFileSize(file.size)}</p>
                  </div>
                )}

                {!file && metadataRef.current && (
                  <div className="bg-slate-700 p-3 rounded-md w-full">
                    <p className="text-white font-medium truncate">{metadataRef.current.name}</p>
                    <p className="text-slate-300 text-sm">{formatFileSize(metadataRef.current.size)}</p>
                  </div>
                )}

                <div className="w-full space-y-2">
                  <Progress value={progress} className="h-2" />
                  <p className="text-right text-sm text-slate-300">{progress}%</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {mode === "complete" && receivedFile && (
          <Card className="bg-slate-800 border-slate-700">
            <CardContent className="pt-6">
              <div className="flex flex-col items-center justify-center space-y-6 py-6">
                <h2 className="text-xl font-semibold text-white">Transfer Complete</h2>

                <div className="bg-slate-700 p-3 rounded-md w-full">
                  <p className="text-white font-medium truncate">{receivedFile.name}</p>
                  <p className="text-slate-300 text-sm">{formatFileSize(receivedFile.size)}</p>
                </div>

                <Button asChild>
                  <a href={receivedFile.url} download={receivedFile.name}>
                    <DownloadIcon className="mr-2 h-4 w-4" />
                    Download File
                  </a>
                </Button>

                <p className="text-slate-300 text-sm text-center">Returning to home screen in a few seconds...</p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {mode === "initial" && (
        <div className="fixed bottom-6 right-6 flex gap-3">
          <Button onClick={generateCode} variant="secondary" size="icon" className="rounded-full h-14 w-14 shadow-lg">
            <DownloadIcon className="h-6 w-6" />
          </Button>
          <Button onClick={openSendMode} variant="default" size="icon" className="rounded-full h-14 w-14 shadow-lg">
            <SendIcon className="h-6 w-6" />
          </Button>
        </div>
      )}
    </div>
  )
}

