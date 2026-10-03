export interface EmployeeCompanySummary {
  id: string;
  name: string;
  isActive: boolean;
}

export interface EmployeeReferenceResponse {
  id: string;
  name: string;
  isActive: boolean;
}

export interface EmployeeSummaryResponse {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  company: EmployeeCompanySummary;
  createdAt: string;
  updatedAt: string;
}

export interface EmployeeResponse extends EmployeeSummaryResponse {
  phone: string | null;
  canChooseDeliveryAddress: boolean;
  canChangeDeliveryTime: boolean;
  canChangePackaging: boolean;
  allergens: EmployeeReferenceResponse[];
  dietaryTags: EmployeeReferenceResponse[];
  isCompanyOwner: boolean;
}
