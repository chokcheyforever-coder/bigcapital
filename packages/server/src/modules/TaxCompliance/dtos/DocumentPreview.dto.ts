import { ApiProperty } from '@nestjs/swagger';
import { IsObject } from 'class-validator';

export class DocumentPreviewDto {
  @ApiProperty({ description: 'Branding template attributes as edited (colors, labels, layout, ...)', type: 'object' })
  @IsObject()
  attributes: Record<string, any>;
}
