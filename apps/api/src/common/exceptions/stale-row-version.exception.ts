import { HttpException, HttpStatus } from '@nestjs/common';

export class StaleRowVersionException extends HttpException {
  constructor() {
    super(
      {
        statusCode: HttpStatus.PRECONDITION_FAILED,
        error: 'Precondition Failed',
        message: 'STALE_ROW_VERSION',
      },
      HttpStatus.PRECONDITION_FAILED,
    );
  }
}
