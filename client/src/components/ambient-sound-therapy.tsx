import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Play, Pause, Volume2, Timer, Waves, Heart, TreePine, Cloud } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface SoundPreset {
  id: string;
  name: string;
  description: string;
  icon: any;
  sounds: {
    id: string;
    name: string;
    frequency?: string;
    color: string;
  }[];
}

export default function AmbientSoundTherapy() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [volume, setVolume] = useState([70]);
  const [timer, setTimer] = useState<number | null>(null);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [selectedDuration, setSelectedDuration] = useState("10");
  const audioContextRef = useRef<AudioContext | null>(null);
  const oscillatorsRef = useRef<Map<string, OscillatorNode>>(new Map());
  const gainNodesRef = useRef<Map<string, GainNode>>(new Map());
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const soundPresets: SoundPreset[] = [
    {
      id: "anxiety-relief",
      name: "Anxiety Relief",
      description: "Calming frequencies to reduce anxiety and promote relaxation",
      icon: Heart,
      sounds: [
        { id: "theta", name: "Theta Waves", frequency: "6Hz", color: "bg-blue-500" },
        { id: "ocean", name: "Ocean Waves", color: "bg-cyan-500" },
        { id: "heartbeat", name: "Slow Heartbeat", frequency: "60 BPM", color: "bg-red-500" },
      ]
    },
    {
      id: "focus-enhancement",
      name: "Focus Enhancement",
      description: "Binaural beats to improve concentration during procedures",
      icon: Waves,
      sounds: [
        { id: "alpha", name: "Alpha Waves", frequency: "10Hz", color: "bg-green-500" },
        { id: "beta", name: "Beta Waves", frequency: "15Hz", color: "bg-yellow-500" },
        { id: "whitenoise", name: "White Noise", color: "bg-gray-500" },
      ]
    },
    {
      id: "nature-therapy",
      name: "Nature Therapy",
      description: "Natural sounds for patient comfort and stress reduction",
      icon: TreePine,
      sounds: [
        { id: "forest", name: "Forest Ambience", color: "bg-green-600" },
        { id: "rain", name: "Gentle Rain", color: "bg-blue-600" },
        { id: "birds", name: "Bird Songs", color: "bg-orange-500" },
      ]
    },
    {
      id: "medical-ambience",
      name: "Medical Ambience",
      description: "Soothing background for medical environments",
      icon: Cloud,
      sounds: [
        { id: "delta", name: "Delta Waves", frequency: "2Hz", color: "bg-purple-500" },
        { id: "chimes", name: "Soft Chimes", color: "bg-pink-500" },
        { id: "ambient", name: "Medical Ambient", color: "bg-indigo-500" },
      ]
    }
  ];

  const timerOptions = [
    { value: 5, label: "5 minutes" },
    { value: 10, label: "10 minutes" },
    { value: 15, label: "15 minutes" },
    { value: 30, label: "30 minutes" },
    { value: 60, label: "1 hour" },
  ];

  useEffect(() => {
    return () => {
      stopAllSounds();
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (timer && isPlaying) {
      setTimeRemaining(timer * 60);
      timerRef.current = setInterval(() => {
        setTimeRemaining((prev) => {
          if (prev <= 1) {
            stopAllSounds();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [timer, isPlaying]);

  const initAudioContext = () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return audioContextRef.current;
  };

  const generateBinauralBeat = (frequency: number) => {
    const audioContext = initAudioContext();
    const leftOscillator = audioContext.createOscillator();
    const rightOscillator = audioContext.createOscillator();
    const leftGain = audioContext.createGain();
    const rightGain = audioContext.createGain();
    const merger = audioContext.createChannelMerger(2);

    leftOscillator.frequency.setValueAtTime(200, audioContext.currentTime);
    rightOscillator.frequency.setValueAtTime(200 + frequency, audioContext.currentTime);

    leftOscillator.type = 'sine';
    rightOscillator.type = 'sine';

    leftGain.gain.setValueAtTime(0.1, audioContext.currentTime);
    rightGain.gain.setValueAtTime(0.1, audioContext.currentTime);

    leftOscillator.connect(leftGain);
    rightOscillator.connect(rightGain);
    leftGain.connect(merger, 0, 0);
    rightGain.connect(merger, 0, 1);
    merger.connect(audioContext.destination);

    return { left: leftOscillator, right: rightOscillator, gainLeft: leftGain, gainRight: rightGain };
  };

  const generateWhiteNoise = () => {
    const audioContext = initAudioContext();
    const bufferSize = 2 * audioContext.sampleRate;
    const noiseBuffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
    const output = noiseBuffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }

    const whiteNoise = audioContext.createBufferSource();
    whiteNoise.buffer = noiseBuffer;
    whiteNoise.loop = true;

    const gainNode = audioContext.createGain();
    gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);

    whiteNoise.connect(gainNode);
    gainNode.connect(audioContext.destination);

    return { source: whiteNoise, gain: gainNode };
  };

  const playPreset = (presetId: string) => {
    stopAllSounds();
    const preset = soundPresets.find(p => p.id === presetId);
    if (!preset) return;

    setActivePreset(presetId);
    setIsPlaying(true);

    preset.sounds.forEach(sound => {
      if (sound.frequency) {
        const freq = parseFloat(sound.frequency);
        if (sound.name.includes('Waves')) {
          const { left, right, gainLeft, gainRight } = generateBinauralBeat(freq);
          oscillatorsRef.current.set(`${sound.id}_left`, left);
          oscillatorsRef.current.set(`${sound.id}_right`, right);
          gainNodesRef.current.set(`${sound.id}_left`, gainLeft);
          gainNodesRef.current.set(`${sound.id}_right`, gainRight);
          left.start();
          right.start();
        }
      } else if (sound.name === 'White Noise') {
        const { source, gain } = generateWhiteNoise();
        oscillatorsRef.current.set(sound.id, source as any);
        gainNodesRef.current.set(sound.id, gain);
        source.start();
      }
    });
  };

  const stopAllSounds = () => {
    oscillatorsRef.current.forEach(oscillator => {
      try {
        oscillator.stop();
      } catch (e) {
        // Oscillator already stopped
      }
    });
    oscillatorsRef.current.clear();
    gainNodesRef.current.clear();
    setIsPlaying(false);
    setActivePreset(null);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setTimeRemaining(0);
  };

  const updateVolume = (newVolume: number[]) => {
    setVolume(newVolume);
    const volumeValue = newVolume[0] / 100;
    gainNodesRef.current.forEach(gainNode => {
      gainNode.gain.setValueAtTime(volumeValue * 0.1, audioContextRef.current?.currentTime || 0);
    });
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="space-y-6">
      <Card className="bg-slate-800 border-slate-600">
        <CardHeader>
          <CardTitle className="text-white flex items-center justify-between">
            <div className="flex items-center">
              <Waves className="w-5 h-5 mr-2 text-blue-400" />
              Ambient Sound Therapy
            </div>
            {timeRemaining > 0 && (
              <Badge variant="outline" className="border-blue-500 text-blue-400">
                <Timer className="w-3 h-3 mr-1" />
                {formatTime(timeRemaining)}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Control Panel */}
          <div className="flex flex-wrap gap-4 items-center">
            <div className="flex items-center gap-2">
              <Button
                onClick={isPlaying ? stopAllSounds : () => {}}
                variant={isPlaying ? "destructive" : "outline"}
                className={isPlaying ? "bg-red-600 hover:bg-red-500" : "border-slate-600 hover:bg-slate-700"}
              >
                {isPlaying ? <Pause className="w-4 h-4 mr-2" /> : <Play className="w-4 h-4 mr-2" />}
                {isPlaying ? "Stop" : "Select Preset"}
              </Button>
            </div>

            <div className="flex items-center gap-2 flex-1 min-w-32">
              <Volume2 className="w-4 h-4 text-slate-400" />
              <Slider
                value={volume}
                onValueChange={updateVolume}
                max={100}
                step={1}
                className="flex-1"
              />
              <span className="text-sm text-slate-400 w-10">{volume[0]}%</span>
            </div>

            <Select value={timer?.toString() || "0"} onValueChange={(value) => {
              const minutes = parseInt(value);
              if (minutes === 0) {
                setTimer(null);
                setTimeRemaining(0);
              } else {
                setTimer(minutes);
                setTimeRemaining(minutes * 60);
              }
            }}>
              <SelectTrigger className="w-32 bg-slate-700 border-slate-600">
                <SelectValue placeholder="Timer" />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-600">
                <SelectItem value="0">No Timer</SelectItem>
                {timerOptions.map(option => (
                  <SelectItem key={option.value} value={option.value.toString()}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Sound Presets */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {soundPresets.map((preset) => {
              const IconComponent = preset.icon;
              const isActive = activePreset === preset.id;
              
              return (
                <Card 
                  key={preset.id}
                  className={`cursor-pointer transition-all duration-200 ${
                    isActive 
                      ? "bg-blue-600 border-blue-400 ring-2 ring-blue-400" 
                      : "bg-slate-700 border-slate-600 hover:border-blue-500"
                  }`}
                  onClick={() => playPreset(preset.id)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start space-x-3">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                        isActive ? "bg-white" : "bg-slate-600"
                      }`}>
                        <IconComponent className={`w-5 h-5 ${isActive ? "text-blue-600" : "text-blue-400"}`} />
                      </div>
                      <div className="flex-1 space-y-2">
                        <h3 className={`font-semibold ${isActive ? "text-white" : "text-white"}`}>
                          {preset.name}
                        </h3>
                        <p className={`text-sm ${isActive ? "text-blue-100" : "text-slate-300"}`}>
                          {preset.description}
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {preset.sounds.map(sound => (
                            <Badge 
                              key={sound.id}
                              className={`${sound.color} text-white text-xs`}
                            >
                              {sound.name} {sound.frequency && `(${sound.frequency})`}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Instructions */}
          <Card className="bg-slate-700 border-slate-600">
            <CardContent className="p-4">
              <h4 className="text-white font-medium mb-2">Therapy Benefits</h4>
              <ul className="text-slate-300 text-sm space-y-1">
                <li>• <strong>Anxiety Relief:</strong> Theta waves and slow rhythms reduce stress hormones</li>
                <li>• <strong>Focus Enhancement:</strong> Alpha and beta frequencies improve concentration</li>
                <li>• <strong>Nature Therapy:</strong> Natural sounds lower blood pressure and heart rate</li>
                <li>• <strong>Medical Ambience:</strong> Creates calming environment during procedures</li>
              </ul>
            </CardContent>
          </Card>
        </CardContent>
      </Card>
    </div>
  );
}