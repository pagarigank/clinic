import { Module as NestModule } from '@nestjs/common';
import { BranchesController } from './branches.controller.js';
import { BranchesService } from './branches.service.js';

@NestModule({
  providers: [BranchesService],
  controllers: [BranchesController],
  exports: [BranchesService],
})
export class AdminModule {}
