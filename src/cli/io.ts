export interface CliIO {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

export const processIO: CliIO = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
};
