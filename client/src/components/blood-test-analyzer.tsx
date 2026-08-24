import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import { AlertTriangle, CheckCircle, TrendingUp, Activity, Zap, FileText } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';

interface BloodTestResult {
  cancerType: 'breast' | 'prostate' | 'lung' | 'cervical' | 'skin' | 'pancreatic' | 'colorectal' | 'ovarian' | 'unknown';
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  abnormalMarkers: {
    marker: string;
    value: number;
    normalRange: string;
    significance: string;
  }[];
  recommendations: string[];
  followUpTests: string[];
}

interface BloodTestValues {
  cea: string;
  ca125: string;
  ca153: string;
  ca199: string;
  psa: string;
  afp: string;
  hcg: string;
  ldh: string;
  cyfra211: string;
  scc: string;
  age: string;
  gender: string;
  symptoms: string;
}

export default function BloodTestAnalyzer() {
  const [testValues, setTestValues] = useState<BloodTestValues>({
    cea: '',
    ca125: '',
    ca153: '',
    ca199: '',
    psa: '',
    afp: '',
    hcg: '',
    ldh: '',
    cyfra211: '',
    scc: '',
    age: '',
    gender: '',
    symptoms: ''
  });
  const [analysisResult, setAnalysisResult] = useState<BloodTestResult | null>(null);
  const { toast } = useToast();

  const analyzeBloodTestMutation = useMutation({
    mutationFn: async (values: BloodTestValues) => {
      // Simulate comprehensive blood test analysis
      const analysis = performBloodTestAnalysis(values);
      
      // Simulate API call delay
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      return analysis;
    },
    onSuccess: (data) => {
      setAnalysisResult(data);
      toast({
        title: "Blood Test Analysis Complete",
        description: "Comprehensive cancer screening results generated",
      });
    },
    onError: () => {
      toast({
        title: "Analysis Failed",
        description: "Failed to analyze blood test results",
        variant: "destructive",
      });
    },
  });

  const performBloodTestAnalysis = (values: BloodTestValues): BloodTestResult => {
    const abnormalMarkers: any[] = [];
    let riskScore = 0;
    let primaryCancerType: any = 'unknown';
    
    // CEA Analysis (Colorectal, Lung, Breast)
    const cea = parseFloat(values.cea);
    if (cea > 3.0) {
      abnormalMarkers.push({
        marker: 'CEA (Carcinoembryonic Antigen)',
        value: cea,
        normalRange: '< 3.0 ng/mL',
        significance: cea > 10 ? 'Highly suggestive of malignancy' : 'Moderately elevated'
      });
      riskScore += cea > 10 ? 30 : 15;
      if (cea > 8) primaryCancerType = 'lung';
    }

    // CA 125 Analysis (Ovarian, Pancreatic)
    const ca125 = parseFloat(values.ca125);
    if (ca125 > 35) {
      abnormalMarkers.push({
        marker: 'CA 125',
        value: ca125,
        normalRange: '< 35 U/mL',
        significance: ca125 > 100 ? 'Strongly indicates ovarian or pancreatic cancer' : 'Elevated, requires follow-up'
      });
      riskScore += ca125 > 100 ? 35 : 20;
      if (ca125 > 65) primaryCancerType = 'ovarian';
    }

    // CA 15-3 Analysis (Breast Cancer)
    const ca153 = parseFloat(values.ca153);
    if (ca153 > 30) {
      abnormalMarkers.push({
        marker: 'CA 15-3',
        value: ca153,
        normalRange: '< 30 U/mL',
        significance: 'Elevated in breast cancer and metastatic disease'
      });
      riskScore += 25;
      primaryCancerType = 'breast';
    }

    // CA 19-9 Analysis (Pancreatic, Colorectal)
    const ca199 = parseFloat(values.ca199);
    if (ca199 > 37) {
      abnormalMarkers.push({
        marker: 'CA 19-9',
        value: ca199,
        normalRange: '< 37 U/mL',
        significance: ca199 > 100 ? 'Highly suspicious for pancreatic cancer' : 'Moderately elevated'
      });
      riskScore += ca199 > 100 ? 40 : 20;
      if (ca199 > 80) primaryCancerType = 'pancreatic';
    }

    // PSA Analysis (Prostate Cancer)
    const psa = parseFloat(values.psa);
    const age = parseInt(values.age);
    let psaThreshold = 4.0;
    if (age > 70) psaThreshold = 6.5;
    else if (age > 60) psaThreshold = 4.5;
    
    if (psa > psaThreshold && values.gender === 'male') {
      abnormalMarkers.push({
        marker: 'PSA (Prostate-Specific Antigen)',
        value: psa,
        normalRange: `< ${psaThreshold} ng/mL (age-adjusted)`,
        significance: psa > 10 ? 'High risk for prostate cancer' : 'Moderately elevated'
      });
      riskScore += psa > 10 ? 30 : 15;
      primaryCancerType = 'prostate';
    }

    // AFP Analysis (Liver Cancer)
    const afp = parseFloat(values.afp);
    if (afp > 20) {
      abnormalMarkers.push({
        marker: 'AFP (Alpha-Fetoprotein)',
        value: afp,
        normalRange: '< 20 ng/mL',
        significance: 'Elevated in liver and testicular cancers'
      });
      riskScore += 20;
    }

    // LDH Analysis (General Cancer Marker)
    const ldh = parseFloat(values.ldh);
    if (ldh > 250) {
      abnormalMarkers.push({
        marker: 'LDH (Lactate Dehydrogenase)',
        value: ldh,
        normalRange: '140-250 U/L',
        significance: 'Elevated in various cancers and tissue damage'
      });
      riskScore += 10;
    }

    // SCC Analysis (Cervical, Skin Cancer)
    const scc = parseFloat(values.scc);
    if (scc > 2.5) {
      abnormalMarkers.push({
        marker: 'SCC Antigen',
        value: scc,
        normalRange: '< 2.5 ng/mL',
        significance: 'Elevated in squamous cell carcinomas'
      });
      riskScore += 25;
      if (values.gender === 'female') primaryCancerType = 'cervical';
      else primaryCancerType = 'skin';
    }

    // Determine risk level
    let riskLevel: 'low' | 'medium' | 'high' | 'critical';
    if (riskScore >= 80) riskLevel = 'critical';
    else if (riskScore >= 50) riskLevel = 'high';
    else if (riskScore >= 25) riskLevel = 'medium';
    else riskLevel = 'low';

    // Generate recommendations
    const recommendations = generateRecommendations(riskLevel, primaryCancerType, abnormalMarkers);
    const followUpTests = generateFollowUpTests(primaryCancerType, riskLevel);

    // `confidence` and `detectionAccuracy` used to be returned here as
    //   confidence:        Math.min(95, 60 + riskScore * 0.5)
    //   detectionAccuracy: 85 + abnormalMarkers.length * 3
    // Both were arithmetic restatements of the risk score wearing the costume of
    // a validated statistic, and both were rendered to the user as percentages.
    // Nothing measured them against an outcome, so there is no number to show.
    // What remains is the marker comparison itself, which is a threshold lookup
    // and is described as one.
    return {
      cancerType: primaryCancerType,
      riskLevel,
      abnormalMarkers,
      recommendations,
      followUpTests,
    };
  };

  const generateRecommendations = (riskLevel: string, cancerType: string, markers: any[]): string[] => {
    const recommendations: string[] = [];
    
    if (riskLevel === 'critical' || riskLevel === 'high') {
      recommendations.push('Immediate oncology consultation required within 48 hours');
      recommendations.push('Comprehensive imaging studies (CT, MRI, PET scan) recommended');
      recommendations.push('Tissue biopsy may be necessary for definitive diagnosis');
    }
    
    if (riskLevel === 'medium') {
      recommendations.push('Follow-up with oncologist within 2 weeks');
      recommendations.push('Repeat blood tests in 2-4 weeks to monitor trends');
      recommendations.push('Additional imaging studies may be warranted');
    }
    
    if (cancerType === 'breast') {
      recommendations.push('Mammography and breast MRI recommended');
      recommendations.push('Clinical breast examination by specialist');
    }
    
    if (cancerType === 'prostate') {
      recommendations.push('Digital rectal examination and prostate MRI');
      recommendations.push('Consider prostate biopsy if PSA continues to rise');
    }
    
    if (cancerType === 'lung') {
      recommendations.push('Low-dose chest CT scan recommended');
      recommendations.push('Pulmonary function tests and bronchoscopy if indicated');
    }
    
    if (markers.length > 2) {
      recommendations.push('Multi-disciplinary team approach for complex case management');
    }
    
    recommendations.push('Genetic counseling if family history of cancer');
    recommendations.push('Lifestyle modifications: diet, exercise, smoking cessation');
    
    return recommendations;
  };

  const generateFollowUpTests = (cancerType: string, riskLevel: string): string[] => {
    const tests = ['Complete Blood Count', 'Comprehensive Metabolic Panel'];
    
    switch (cancerType) {
      case 'breast':
        tests.push('CA 27.29', 'HER2/neu', 'BRCA1/BRCA2 genetic testing');
        break;
      case 'prostate':
        tests.push('Free PSA', 'PCA3', 'ExosomeDx Prostate');
        break;
      case 'lung':
        tests.push('CYFRA 21-1', 'NSE', 'Pro-GRP');
        break;
      case 'ovarian':
        tests.push('HE4', 'OVA1', 'ROMA index');
        break;
      case 'pancreatic':
        tests.push('CA 72-4', 'Pancreatic elastase');
        break;
      case 'cervical':
        tests.push('HPV DNA', 'p16/Ki-67 dual stain');
        break;
    }
    
    if (riskLevel === 'high' || riskLevel === 'critical') {
      tests.push('Circulating tumor DNA (ctDNA)', 'Liquid biopsy panel');
    }
    
    return tests;
  };

  const handleInputChange = (field: keyof BloodTestValues, value: string) => {
    setTestValues(prev => ({ ...prev, [field]: value }));
  };

  const handleAnalyze = () => {
    const requiredFields = ['age', 'gender'];
    const missingFields = requiredFields.filter(field => !testValues[field as keyof BloodTestValues]);
    
    if (missingFields.length > 0) {
      toast({
        title: "Missing Information",
        description: "Please provide age and gender information",
        variant: "destructive",
      });
      return;
    }

    const hasBloodValues = Object.entries(testValues)
      .filter(([key]) => !['age', 'gender', 'symptoms'].includes(key))
      .some(([, value]) => value.trim() !== '');

    if (!hasBloodValues) {
      toast({
        title: "No Blood Test Values",
        description: "Please enter at least one blood test value",
        variant: "destructive",
      });
      return;
    }

    analyzeBloodTestMutation.mutate(testValues);
  };

  const getRiskColor = (risk: string) => {
    switch (risk) {
      case 'critical': return 'bg-red-600 text-white';
      case 'high': return 'bg-red-100 text-red-800 border-red-300';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'low': return 'bg-green-100 text-green-800 border-green-300';
      default: return 'bg-slate-100 dark:bg-slate-700 text-foreground border-slate-300 dark:border-slate-600';
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="w-6 h-6 text-red-600" />
            Tumour Marker Reference Tool
          </CardTitle>
          <CardDescription>
            {/* Previously: "Advanced screening that can detect cancers not
                visible in imaging" — a diagnostic capability claim for what is a
                table of published reference ranges. */}
            Compares entered tumour marker values against published reference
            ranges. Not a screening test and not a detector.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* This tool has no model behind it. It is a hand-coded threshold
              lookup over CEA, CA-125, CA 19-9, PSA and AFP, written from
              reference ranges and never validated against patient outcomes.
              Stated up front rather than in a footer, because the risk tiers it
              prints ("CRITICAL RISK") read like a finding. */}
          <div className="bg-amber-50 border-2 border-amber-300 p-4 rounded-lg">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-700 mt-0.5 flex-shrink-0" />
              <div className="text-sm">
                <p className="font-semibold text-amber-900 mb-1">
                  Reference tool — not validated, not a diagnosis
                </p>
                <p className="text-amber-800">
                  This compares your values against published reference ranges
                  using fixed thresholds. No AI model is involved and it has never
                  been tested against real patient outcomes, so it cannot tell you
                  whether you have cancer. Tumour markers rise in pregnancy,
                  infection, liver disease, benign growths and menstruation, and
                  are normal in many people who do have cancer. Only a clinician
                  who can see your full history can interpret these.
                </p>
              </div>
            </div>
          </div>
          {/* Patient Information */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="age">Age *</Label>
              <Input
                id="age"
                type="number"
                placeholder="Enter age"
                value={testValues.age}
                onChange={(e) => handleInputChange('age', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gender">Gender *</Label>
              <Select value={testValues.gender} onValueChange={(value) => handleInputChange('gender', value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select gender" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="male">Male</SelectItem>
                  <SelectItem value="female">Female</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="symptoms">Symptoms (Optional)</Label>
              <Input
                id="symptoms"
                placeholder="Any symptoms or concerns"
                value={testValues.symptoms}
                onChange={(e) => handleInputChange('symptoms', e.target.value)}
              />
            </div>
          </div>

          <Separator />

          {/* Blood Test Values */}
          <div>
            <h3 className="font-semibold mb-4">Blood Test Results (Enter available values)</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="cea">CEA (ng/mL)</Label>
                <Input
                  id="cea"
                  type="number"
                  step="0.1"
                  placeholder="Normal: < 3.0"
                  value={testValues.cea}
                  onChange={(e) => handleInputChange('cea', e.target.value)}
                />
                <p className="text-xs text-muted-foreground">Colorectal, Lung, Breast</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ca125">CA 125 (U/mL)</Label>
                <Input
                  id="ca125"
                  type="number"
                  step="0.1"
                  placeholder="Normal: < 35"
                  value={testValues.ca125}
                  onChange={(e) => handleInputChange('ca125', e.target.value)}
                />
                <p className="text-xs text-muted-foreground">Ovarian, Pancreatic</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ca153">CA 15-3 (U/mL)</Label>
                <Input
                  id="ca153"
                  type="number"
                  step="0.1"
                  placeholder="Normal: < 30"
                  value={testValues.ca153}
                  onChange={(e) => handleInputChange('ca153', e.target.value)}
                />
                <p className="text-xs text-muted-foreground">Breast Cancer</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ca199">CA 19-9 (U/mL)</Label>
                <Input
                  id="ca199"
                  type="number"
                  step="0.1"
                  placeholder="Normal: < 37"
                  value={testValues.ca199}
                  onChange={(e) => handleInputChange('ca199', e.target.value)}
                />
                <p className="text-xs text-muted-foreground">Pancreatic, Colorectal</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="psa">PSA (ng/mL)</Label>
                <Input
                  id="psa"
                  type="number"
                  step="0.1"
                  placeholder="Age-dependent"
                  value={testValues.psa}
                  onChange={(e) => handleInputChange('psa', e.target.value)}
                />
                <p className="text-xs text-muted-foreground">Prostate Cancer (Male)</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="afp">AFP (ng/mL)</Label>
                <Input
                  id="afp"
                  type="number"
                  step="0.1"
                  placeholder="Normal: < 20"
                  value={testValues.afp}
                  onChange={(e) => handleInputChange('afp', e.target.value)}
                />
                <p className="text-xs text-muted-foreground">Liver, Testicular</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ldh">LDH (U/L)</Label>
                <Input
                  id="ldh"
                  type="number"
                  step="1"
                  placeholder="Normal: 140-250"
                  value={testValues.ldh}
                  onChange={(e) => handleInputChange('ldh', e.target.value)}
                />
                <p className="text-xs text-muted-foreground">General Cancer Marker</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="scc">SCC Antigen (ng/mL)</Label>
                <Input
                  id="scc"
                  type="number"
                  step="0.1"
                  placeholder="Normal: < 2.5"
                  value={testValues.scc}
                  onChange={(e) => handleInputChange('scc', e.target.value)}
                />
                <p className="text-xs text-muted-foreground">Cervical, Skin Cancer</p>
              </div>
            </div>
          </div>

          {/* Analyze Button */}
          <Button 
            onClick={handleAnalyze}
            disabled={analyzeBloodTestMutation.isPending}
            className="w-full bg-gradient-to-r from-red-600 to-pink-600 hover:from-red-700 hover:to-pink-700 text-white font-semibold shadow-lg hover:shadow-xl transition-all duration-300"
            size="lg"
          >
            {analyzeBloodTestMutation.isPending ? (
              <div className="flex items-center justify-center space-x-2">
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                <span>Analyzing Blood Markers...</span>
              </div>
            ) : (
              <div className="flex items-center justify-center space-x-2">
                <Activity className="w-5 h-5" />
                <span>Analyze Blood Test Results</span>
                <Badge variant="secondary" className="ml-2 bg-white bg-opacity-20 text-white">
                  Advanced Screening
                </Badge>
              </div>
            )}
          </Button>

          {/* Analysis Progress */}
          {analyzeBloodTestMutation.isPending && (
            <div className="text-center space-y-2">
              <Progress value={75} className="w-full" />
              <p className="text-sm text-muted-foreground">
                Processing tumor markers and cancer risk assessment...
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Analysis Results */}
      {analysisResult && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-blue-600" />
              Blood Test Cancer Screening Results
            </CardTitle>
            <CardDescription>
              Comprehensive analysis of blood tumor markers for early cancer detection
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Primary Results */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardContent className="p-4 text-center">
                  <Badge className={`mb-2 ${getRiskColor(analysisResult.riskLevel)}`}>
                    {analysisResult.riskLevel.toUpperCase()} RISK
                  </Badge>
                  <div className="text-sm text-muted-foreground">Cancer Risk Level</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
                  <div className="text-lg font-semibold mb-2 text-red-600 capitalize">
                    {analysisResult.cancerType !== 'unknown' ? `${analysisResult.cancerType} Cancer` : 'General Screening'}
                  </div>
                  <div className="text-sm text-muted-foreground">Primary Concern</div>
                </CardContent>
              </Card>
            </div>

            {/* Critical Alert */}
            {analysisResult.riskLevel === 'critical' && (
              <div className="bg-red-50 border border-red-200 p-4 rounded-lg">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <h4 className="font-semibold text-red-800 mb-1">Critical Risk Level Detected</h4>
                    <p className="text-red-700 text-sm">
                      Multiple elevated tumor markers suggest high probability of malignancy. 
                      Immediate medical attention and comprehensive diagnostic workup required.
                    </p>
                  </div>
                </div>
              </div>
            )}

            <Separator />

            {/* Abnormal Markers */}
            {analysisResult.abnormalMarkers.length > 0 && (
              <div className="space-y-4">
                <h3 className="font-semibold text-red-700">Elevated Tumor Markers ({analysisResult.abnormalMarkers.length})</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {analysisResult.abnormalMarkers.map((marker, index) => (
                    <Card key={index} className="border-red-200">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between mb-2">
                          <h4 className="font-medium text-red-800">{marker.marker}</h4>
                          <Badge variant="destructive" className="text-xs">
                            {marker.value}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground mb-1">
                          <strong>Normal Range:</strong> {marker.normalRange}
                        </p>
                        <p className="text-sm text-red-700">
                          <strong>Significance:</strong> {marker.significance}
                        </p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {/* Follow-up Tests */}
            <div className="space-y-4">
              <h3 className="font-semibold">Recommended Follow-up Tests</h3>
              <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                <ul className="space-y-2">
                  {analysisResult.followUpTests.map((test, index) => (
                    <li key={index} className="flex items-start gap-2">
                      <CheckCircle className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                      <span className="text-sm">{test}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Clinical Recommendations */}
            <div className="space-y-4">
              <h3 className="font-semibold">Clinical Recommendations</h3>
              <div className="bg-green-50 p-4 rounded-lg border border-green-200">
                <ul className="space-y-2">
                  {analysisResult.recommendations.map((rec, index) => (
                    <li key={index} className="flex items-start gap-2">
                      <Zap className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                      <span className="text-sm">{rec}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Important Notice */}
            <div className="bg-yellow-50 border border-yellow-200 p-4 rounded-lg">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-5 h-5 text-yellow-600 mt-0.5 flex-shrink-0" />
                <div className="text-sm">
                  <p className="font-medium text-yellow-800 mb-1">Medical Disclaimer</p>
                  <p className="text-yellow-700">
                    Blood test analysis is for educational purposes. Tumor markers can be elevated in non-cancerous conditions. 
                    Always consult with qualified healthcare professionals for proper interpretation and medical decisions.
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}