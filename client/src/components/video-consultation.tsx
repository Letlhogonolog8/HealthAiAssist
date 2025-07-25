import React, { useRef, useEffect, useState } from 'react';

export default function VideoConsultation({ appointmentId }: { appointmentId: number }) {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Basic WebRTC setup (simplified)
    let localStream: MediaStream;
    let peerConnection: RTCPeerConnection;

    async function startCall() {
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = localStream;
        }

        peerConnection = new RTCPeerConnection();

        localStream.getTracks().forEach(track => {
          peerConnection.addTrack(track, localStream);
        });

        peerConnection.ontrack = (event) => {
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = event.streams[0];
          }
        };

        // Signaling logic to be implemented here (e.g., via WebSocket)

        setIsConnected(true);
      } catch (err) {
        setError('Failed to access camera or microphone.');
        console.error(err);
      }
    }

    startCall();

    return () => {
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
      }
      if (peerConnection) {
        peerConnection.close();
      }
    };
  }, [appointmentId]);

  if (error) {
    return <div className="text-red-600">Error: {error}</div>;
  }

  return (
    <div className="flex flex-col space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Video Consultation</h2>
      </div>
      <div className="flex space-x-4">
        <video ref={localVideoRef} autoPlay muted playsInline className="w-1/2 rounded-lg border" />
        <video ref={remoteVideoRef} autoPlay playsInline className="w-1/2 rounded-lg border" />
      </div>
      {!isConnected && <p>Connecting...</p>}
    </div>
  );
}
