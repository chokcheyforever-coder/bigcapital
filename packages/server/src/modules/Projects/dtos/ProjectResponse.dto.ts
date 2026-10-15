import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ProjectResponseDto {
  @ApiProperty() id: number;
  @ApiProperty() name: string;
  @ApiPropertyOptional() code: string | null;
  @ApiPropertyOptional() description: string | null;
  @ApiPropertyOptional() contactId: number | null;
  @ApiPropertyOptional() customerName: string | null;
  @ApiPropertyOptional() startDate: string | null;
  @ApiPropertyOptional() deadline: string | null;
  @ApiProperty({ enum: ['active', 'closed'] }) status: 'active' | 'closed';
  @ApiProperty() createdAt: Date;
}
