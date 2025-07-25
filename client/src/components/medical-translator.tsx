import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Mic, MicOff, Volume2, Search, BookOpen, Plus, Languages } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";


interface MedicalTerm {
  id: number;
  term: string;
  definition: string;
  pronunciation: string | null;
  category: string;
}

export default function MedicalTranslator() {
  const [searchTerm, setSearchTerm] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [selectedTerm, setSelectedTerm] = useState<MedicalTerm | null>(null);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [newTerm, setNewTerm] = useState({ term: "", definition: "", category: "General" });
  const recognitionRef = useRef<any>(null);
  const queryClient = useQueryClient();

  const { data: terms = [], isLoading } = useQuery({
    queryKey: ["/api/medical-terms", searchTerm],
    queryFn: async () => {
      if (!searchTerm.trim()) return [];
      const response = await fetch(`/api/medical-terms/search?q=${encodeURIComponent(searchTerm)}`);
      return response.json();
    },
    enabled: searchTerm.length > 2,
  });

  const { data: allTerms = [] } = useQuery({
    queryKey: ["/api/medical-terms"],
    queryFn: async () => {
      const response = await fetch("/api/medical-terms");
      return response.json();
    },
  });

  const addTermMutation = useMutation({
    mutationFn: async (termData: { term: string; definition: string; category: string }) => {
      const response = await fetch("/api/medical-terms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(termData),
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/medical-terms"] });
      setIsAddDialogOpen(false);
      setNewTerm({ term: "", definition: "", category: "General" });
    },
  });

  const speakText = (text: string, pronunciation?: string) => {
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(pronunciation || text);
      utterance.rate = 0.8;
      utterance.pitch = 1;
      utterance.volume = 0.8;
      speechSynthesis.speak(utterance);
    }
  };

  const startListening = () => {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = false;
      recognitionRef.current.lang = 'en-US';

      recognitionRef.current.onstart = () => setIsListening(true);
      recognitionRef.current.onend = () => setIsListening(false);
      recognitionRef.current.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setSearchTerm(transcript);
      };

      recognitionRef.current.start();
    }
  };

  const stopListening = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
  };

  const speakTerm = (text: string, pronunciation?: string | null) => {
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(pronunciation || text);
      utterance.rate = 0.8;
      utterance.pitch = 1;
      speechSynthesis.speak(utterance);
    }
  };

  const categoryColors = {
    imaging: "bg-blue-500",
    procedure: "bg-green-500",
    oncology: "bg-red-500",
    specialty: "bg-purple-500",
    diagnosis: "bg-yellow-500",
  };

  const displayTerms = searchTerm.length > 2 ? terms : allTerms.slice(0, 6);

  return (
    <div className="space-y-6">
      <Card className="bg-slate-800 border-slate-600">
        <CardHeader>
          <CardTitle className="text-white flex items-center">
            <BookOpen className="w-5 h-5 mr-2 text-blue-400" />
            Voice-Enabled Medical Translator
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <div className="flex-1">
              <Input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search medical terms or speak..."
                className="bg-slate-700 border-slate-600 text-white"
              />
            </div>
            <Button
              onClick={isListening ? stopListening : startListening}
              variant={isListening ? "destructive" : "outline"}
              size="icon"
              className={isListening ? "bg-red-600 hover:bg-red-500" : "border-slate-600 hover:bg-slate-700"}
            >
              {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </Button>
            <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="icon" className="border-slate-600 hover:bg-slate-700">
                  <Plus className="w-4 h-4" />
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-slate-800 border-slate-600">
                <DialogHeader>
                  <DialogTitle className="text-white">Add New Medical Term</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="term" className="text-white">Medical Term</Label>
                    <Input
                      id="term"
                      value={newTerm.term}
                      onChange={(e) => setNewTerm({ ...newTerm, term: e.target.value })}
                      placeholder="Enter medical term"
                      className="bg-slate-700 border-slate-600 text-white"
                    />
                  </div>
                  <div>
                    <Label htmlFor="definition" className="text-white">Definition</Label>
                    <Textarea
                      id="definition"
                      value={newTerm.definition}
                      onChange={(e) => setNewTerm({ ...newTerm, definition: e.target.value })}
                      placeholder="Enter definition"
                      className="bg-slate-700 border-slate-600 text-white"
                      rows={3}
                    />
                  </div>
                  <div>
                    <Label htmlFor="category" className="text-white">Category</Label>
                    <Select value={newTerm.category} onValueChange={(value) => setNewTerm({ ...newTerm, category: value })}>
                      <SelectTrigger className="bg-slate-700 border-slate-600 text-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-slate-700 border-slate-600">
                        <SelectItem value="General">General</SelectItem>
                        <SelectItem value="Imaging">Imaging</SelectItem>
                        <SelectItem value="Procedure">Procedure</SelectItem>
                        <SelectItem value="Oncology">Oncology</SelectItem>
                        <SelectItem value="Anatomy">Anatomy</SelectItem>
                        <SelectItem value="Pathology">Pathology</SelectItem>
                        <SelectItem value="Treatment">Treatment</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      onClick={() => setIsAddDialogOpen(false)}
                      className="border-slate-600 hover:bg-slate-700"
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={() => addTermMutation.mutate(newTerm)}
                      disabled={!newTerm.term || !newTerm.definition || addTermMutation.isPending}
                      className="bg-blue-600 hover:bg-blue-500"
                    >
                      {addTermMutation.isPending ? "Adding..." : "Add Term"}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          {isLoading && (
            <div className="text-center text-slate-400 py-4">
              Searching medical terms...
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {displayTerms.map((term: MedicalTerm) => (
              <Tooltip key={term.id}>
                <TooltipTrigger asChild>
                  <Card 
                    className="bg-slate-700 border-slate-600 hover:border-blue-500 transition-colors cursor-pointer"
                    onClick={() => setSelectedTerm(term)}
                  >
                    <CardContent className="p-4">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <h4 className="font-semibold text-white text-sm">{term.term}</h4>
                          <Badge 
                            className={`${categoryColors[term.category as keyof typeof categoryColors] || 'bg-gray-500'} text-white text-xs`}
                          >
                            {term.category}
                          </Badge>
                        </div>
                        <p className="text-slate-300 text-xs line-clamp-2">{term.definition}</p>
                        {term.pronunciation && (
                          <div className="flex items-center justify-between">
                            <span className="text-blue-400 text-xs">{term.pronunciation}</span>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={(e) => {
                                e.stopPropagation();
                                speakTerm(term.term, term.pronunciation);
                              }}
                              className="h-6 w-6 p-0 hover:bg-slate-600"
                            >
                              <Volume2 className="w-3 h-3 text-blue-400" />
                            </Button>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </TooltipTrigger>
                <TooltipContent side="top" className="bg-slate-900 border-slate-600 text-white max-w-xs">
                  <div className="space-y-1">
                    <p className="font-semibold">{term.term}</p>
                    <p className="text-sm">{term.definition}</p>
                    {term.pronunciation && (
                      <p className="text-blue-400 text-sm">Pronunciation: {term.pronunciation}</p>
                    )}
                  </div>
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        </CardContent>
      </Card>

      {selectedTerm && (
        <Card className="bg-slate-800 border-slate-600">
          <CardHeader>
            <CardTitle className="text-white flex items-center justify-between">
              <span>{selectedTerm.term}</span>
              <div className="flex items-center gap-2">
                <Badge className={`${categoryColors[selectedTerm.category as keyof typeof categoryColors] || 'bg-gray-500'} text-white`}>
                  {selectedTerm.category}
                </Badge>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => speakTerm(selectedTerm.term, selectedTerm.pronunciation)}
                  className="border-slate-600 hover:bg-slate-700"
                >
                  <Volume2 className="w-4 h-4 mr-1" />
                  Pronounce
                </Button>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <h4 className="text-blue-400 font-medium mb-1">Definition</h4>
              <p className="text-slate-300">{selectedTerm.definition}</p>
            </div>
            {selectedTerm.pronunciation && (
              <div>
                <h4 className="text-blue-400 font-medium mb-1">Pronunciation</h4>
                <p className="text-slate-300 font-mono">{selectedTerm.pronunciation}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}